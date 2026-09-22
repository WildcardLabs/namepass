import assert from "node:assert/strict";
import test from "node:test";

import {
	goldskyHandler,
	ensExpiryProjection,
	ensRenewalLabel,
	externalRenewalProjection,
	externalSettlementPatch,
	originBurnReconciliationStatus,
	reorgResumeStatus,
	parseGoldskyEvent,
	type GoldskyEvent,
	type GoldskyStore,
	type GoldskyTransaction,
} from "./goldsky";
import { ApiError } from "./http";

const secret = "Bearer test-secret";
const recipient = "0x043c184003266644372ba5fa4946777b3f1cfc3d";

function transfer(gsOp: "c" | "i" | "d" = "c") {
	return {
		event_id: "84532:log_blockhash_1",
		event_family: "deposit",
		event_type: "Transfer",
		chain_id: 84532,
		block_number: 10,
		block_time: 1_723_372_800_000,
		tx_hash: `0x${"1".repeat(64)}`,
		log_index: 1,
		token_address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
		sender_address: "0x0000000000000000000000000000000000000001",
		recipient_address: recipient,
		amount: "5000000",
		_gs_op: gsOp,
	};
}

function request(body: string, authorization = secret) {
	return new Request("https://namepass.test/api/webhooks/goldsky", {
		method: "POST",
		headers: { authorization, "content-type": "application/json" },
		body,
	});
}

class MemoryStore implements GoldskyStore, GoldskyTransaction {
	readonly events = new Map<string, GoldskyEvent>();
	readonly deposits = new Map<string, { status: "detected" | "orphaned" }>();
	readonly flows: Array<{
		id: string;
		nameId: string;
		chainId: number;
		amount: string;
		depositEventId: string | null;
		status: "queued" | "cancelled";
	}> = [];
	renewalReconciliations = 0;
	renewalAggregateRefreshes = 0;
	expiryRefreshes = 0;
	settlementLocks = 0;
	lastOperation: "upsert" | "lock" | "reconcile" | undefined;
	readonly scanMarkers = new Set<string>();
	readonly absorbedDeposits = new Set<string>();

	async transaction<T>(work: (tx: GoldskyTransaction) => Promise<T>): Promise<T> {
		return work(this);
	}

	async upsertEvent(event: GoldskyEvent): Promise<void> {
		this.events.set(event.eventId, event);
		this.lastOperation = "upsert";
	}

	async lockSettlementTransaction(): Promise<void> {
		assert.equal(this.lastOperation, "upsert");
		this.lastOperation = "lock";
		this.settlementLocks += 1;
	}

	async nameIdForAddress(address: string): Promise<string | undefined> {
		return address === recipient ? "name-1" : undefined;
	}

	async upsertDeposit(event: GoldskyEvent): Promise<void> {
		this.deposits.set(event.eventId, { status: event.gsOp === "c" ? "detected" : "orphaned" });
	}

	async reconcileOriginBurn(): Promise<string | undefined> { return "flow-origin"; }

	async reconcileRenewal(): Promise<string | undefined> {
		assert.equal(this.lastOperation, "lock");
		this.lastOperation = "reconcile";
		this.renewalReconciliations += 1;
		return "name-1";
	}

	async refreshRenewalAggregates(): Promise<void> { this.renewalAggregateRefreshes += 1; }

	async refreshEnsExpiry(): Promise<void> {
		assert.equal(this.lastOperation, "lock");
		this.lastOperation = "reconcile";
		this.expiryRefreshes += 1;
	}

	async markChainForScan(nameId: string, chainId: number): Promise<void> {
		this.scanMarkers.add(`${nameId}:${chainId}`);
	}

	async ensureFlow(
		nameId: string,
		chainId: number,
		amount: string,
		depositEventId: string | null,
	): Promise<string | undefined> {
		if (depositEventId && this.absorbedDeposits.has(depositEventId)) return undefined;
		const linked = depositEventId
			? this.flows.find((flow) => flow.depositEventId === depositEventId)
			: undefined;
		if (linked) {
			linked.status = "queued";
			return linked.id;
		}
		const existing = this.flows.find(
			(flow) => flow.nameId === nameId && flow.chainId === chainId && flow.status === "queued",
		);
		if (existing) {
			existing.depositEventId = null;
			await this.markChainForScan(nameId, chainId);
			return existing.id;
		}
		const id = `flow-${this.flows.length + 1}`;
		this.flows.push({ id, nameId, chainId, amount, depositEventId, status: "queued" });
		return id;
	}

	async cancelUnbroadcastFlow(nameId: string, chainId: number, depositEventId: string): Promise<void> {
		for (const flow of this.flows) {
			if (
				flow.nameId === nameId
				&& flow.chainId === chainId
				&& flow.depositEventId === depositEventId
				&& flow.status === "queued"
			) {
				flow.status = "cancelled";
			}
		}
	}
}

test("authentication runs before JSON parsing and body limits", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(store, async () => {}, () => secret);

	const unauthorized = await route.fetch(request("not json", "wrong"));
	assert.equal(unauthorized.status, 401);
	assert.equal((await unauthorized.json()).error.code, "invalid_webhook_auth");
	assert.equal(store.events.size, 0);

	const tooLarge = await route.fetch(request(`{"padding":"${"x".repeat(8_192)}"}`));
	assert.equal(tooLarge.status, 200);
	assert.equal((await tooLarge.json()).skipped, true);
});

test("a duplicate create upserts one deposit and one active flow", async () => {
	const store = new MemoryStore();
	const started: string[] = [];
	const route = goldskyHandler(store, async (flowId) => void started.push(flowId), () => secret);

	for (const gsOp of ["c", "i"] as const) {
		const response = await route.fetch(request(JSON.stringify(transfer(gsOp))));
		assert.equal(response.status, 200);
	}

	assert.equal(store.events.size, 1);
	assert.equal(store.deposits.size, 1);
	assert.equal(store.flows.length, 1);
	assert.equal(store.flows[0]?.depositEventId, transfer().event_id);
	assert.deepEqual(started, ["flow-1", "flow-1"]);
	assert.equal(store.events.get(transfer().event_id)?.gsOp, "c");
	assert.throws(
		() => parseGoldskyEvent({ ...transfer(), _gs_op: "u" }),
		(error: unknown) => error instanceof ApiError && error.code === "invalid_goldsky_event",
	);
});

test("the receiver accepts Goldsky ISO block timestamps", () => {
	const event = parseGoldskyEvent({
		...transfer(),
		block_time: "2024-08-12T00:00:00.000Z",
	});
	assert.equal(event.blockTime.toISOString(), "2024-08-12T00:00:00.000Z");
});

test("automatic flow creation starts at the configured minimum", async () => {
	const store = new MemoryStore();
	const started: string[] = [];
	const route = goldskyHandler(
		store,
		async (flowId) => void started.push(flowId),
		() => secret,
		async () => undefined,
	);
	const below = { ...transfer(), event_id: "84532:below", amount: "499999" };
	const threshold = {
		...transfer(),
		event_id: "84532:threshold",
		tx_hash: `0x${"3".repeat(64)}`,
		log_index: 2,
		amount: "500000",
	};

	assert.equal((await route.fetch(request(JSON.stringify(below)))).status, 200);
	assert.equal(store.flows.length, 0);
	assert.equal((await route.fetch(request(JSON.stringify(threshold)))).status, 200);
	assert.equal(store.flows.length, 1);
	assert.deepEqual(started, ["flow-1"]);
});

test("two small deposits start one flow when their wallet balance reaches the minimum", async () => {
	const store = new MemoryStore();
	const started: string[] = [];
	const balances = ["250000", "500000"];
	const route = goldskyHandler(
		store,
		async (flowId) => void started.push(flowId),
		() => secret,
		async (address, chainId) => {
			assert.equal(address, recipient);
			assert.equal(chainId, 84532);
			return balances.shift();
		},
	);
	const first = { ...transfer(), event_id: "84532:small-1", amount: "250000" };
	const second = {
		...transfer(),
		event_id: "84532:small-2",
		tx_hash: `0x${"4".repeat(64)}`,
		log_index: 2,
		amount: "250000",
	};

	assert.equal((await route.fetch(request(JSON.stringify(first)))).status, 200);
	assert.equal(store.flows.length, 0);
	assert.equal((await route.fetch(request(JSON.stringify(second)))).status, 200);
	assert.equal(store.flows.length, 1);
	assert.equal(store.flows[0]?.amount, "500000");
	assert.equal(store.flows[0]?.depositEventId, null);
	assert.deepEqual(started, ["flow-1"]);
});

test("a deposit during an active flow leaves a bounded balance-scan marker", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(store, async () => {}, () => secret);
	const later = {
		...transfer(),
		event_id: "84532:later",
		tx_hash: `0x${"9".repeat(64)}`,
		log_index: 9,
	};

	assert.equal((await route.fetch(request(JSON.stringify(transfer())))).status, 200);
	assert.equal((await route.fetch(request(JSON.stringify(later)))).status, 200);
	assert.equal(store.flows.length, 1);
	assert.equal(store.flows[0]?.depositEventId, null);
	assert.deepEqual([...store.scanMarkers], ["name-1:84532"]);
});

test("a late deposit that an earlier burn absorbed does not start a ghost flow", async () => {
	const store = new MemoryStore();
	store.absorbedDeposits.add(transfer().event_id);
	const started: string[] = [];
	const route = goldskyHandler(store, async (flowId) => void started.push(flowId), () => secret);

	assert.equal((await route.fetch(request(JSON.stringify(transfer())))).status, 200);
	assert.equal(store.deposits.size, 1);
	assert.equal(store.flows.length, 0);
	assert.deepEqual(started, []);
});

test("a failed small-deposit balance read leaves a recovery marker", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(
		store,
		async () => {},
		() => secret,
		async () => { throw new Error("RPC unavailable"); },
	);
	const small = { ...transfer(), event_id: "84532:small-rpc-failure", amount: "250000" };

	assert.equal((await route.fetch(request(JSON.stringify(small)))).status, 200);
	assert.equal(store.flows.length, 0);
	assert.deepEqual([...store.scanMarkers], ["name-1:84532"]);
});

test("delete is idempotent and replay resumes the same deposit flow", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(store, async () => {}, () => secret);

	assert.equal((await route.fetch(request(JSON.stringify(transfer("c"))))).status, 200);
	assert.equal((await route.fetch(request(JSON.stringify(transfer("d"))))).status, 200);
	assert.equal((await route.fetch(request(JSON.stringify(transfer("d"))))).status, 200);
	assert.equal(store.flows.length, 1);
	assert.equal(store.flows[0]?.status, "cancelled");
	assert.equal(store.deposits.get(transfer().event_id)?.status, "orphaned");

	assert.equal((await route.fetch(request(JSON.stringify(transfer("c"))))).status, 200);
	assert.equal(store.flows.length, 1);
	assert.deepEqual(store.flows.map((flow) => flow.status), ["queued"]);
	assert.equal(store.deposits.get(transfer().event_id)?.status, "detected");
	assert.equal(store.events.get(transfer().event_id)?.gsOp, "c");
});

test("a queued flow is not acknowledged when Workflow cannot start", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(
		store,
		async () => {
			throw new ApiError(503, "workflow_unavailable", "Workflow is unavailable.");
		},
		() => secret,
	);
	const response = await route.fetch(request(JSON.stringify(transfer())));
	assert.equal(response.status, 503);
	assert.equal((await response.json()).error.code, "workflow_unavailable");
	assert.equal(store.flows.length, 1);
});

test("the receiver skips an invalid event with 200 so it cannot crash the pipeline", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(store, async () => {}, () => secret);
	const body = { ...transfer(), token_address: "0x0000000000000000000000000000000000000000" };
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (message) => void warnings.push(String(message));
	try {
		const response = await route.fetch(request(JSON.stringify(body)));
		// A non-retriable 4xx makes Goldsky treat the row as a poison pill and crash the
		// whole pipeline. An invalid event is acknowledged (200) and skipped, not ingested.
		assert.equal(response.status, 200);
		assert.equal((await response.json()).skipped, true);
		assert.equal(store.events.size, 0);
		const warning = JSON.parse(warnings[0] ?? "{}") as Record<string, unknown>;
		assert.equal(warning.event, "goldsky.rejected_payload");
		assert.equal(warning.errorCode, "invalid_goldsky_event");
		assert.equal(warning.eventId, body.event_id);
		assert.equal(warning.blockNumber, body.block_number);
		assert.match(String(warning.payloadHash), /^[0-9a-f]{64}$/);
		assert.ok(!warnings[0]?.includes(body.token_address));
		assert.ok(!Number.isNaN(Date.parse(String(warning.receivedAt))));

		assert.equal((await route.fetch(request(JSON.stringify(transfer())))).status, 200);
		assert.equal(store.events.size, 1);
	} finally {
		console.warn = warn;
	}
});

test("an ENS delete clears the only indexed expiry and preserves a newer indexed expiry", () => {
	const event = { label: "alice", new_expiry: "2000000000" };
	assert.deepEqual(ensExpiryProjection(event, undefined, true), { label: "alice", expiry: null });
	assert.deepEqual(
		ensExpiryProjection(event, { label: "alice", new_expiry: "2100000000" }, true),
		{ label: "alice", expiry: new Date(2_100_000_000_000) },
	);
	assert.deepEqual(ensExpiryProjection(event, undefined, false), {
		label: "alice",
		expiry: new Date(2_000_000_000_000),
	});
});

test("all protocol event shapes match their registry allowlists", () => {
	const hash = `0x${"2".repeat(64)}`;
	const wallet = recipient;
	const factory = "0x2dcb5ca6b21372b43e37c35da8d5d15160423150";
	const helper = "0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f";
	const hubCommon = {
		chain_id: 11155111,
		block_number: 10,
		block_time: 1_723_372_800,
		tx_hash: `0x${"1".repeat(64)}`,
		log_index: 1,
		_gs_op: "c",
	};
	const events = [
		{
			...hubCommon,
			event_id: "11155111:wallet",
			event_family: "namepass",
			event_type: "WalletDeployed",
			contract_address: factory,
			label_key: hash,
			wallet_address: wallet,
			label: "vitalik",
		},
		{
			...hubCommon,
			event_id: "11155111:processed",
			event_family: "namepass",
			event_type: "DepositProcessed",
			contract_address: factory,
			label_key: hash,
			wallet_address: wallet,
			amount: "5000000",
			remaining_amount: "0",
		},
		{
			...hubCommon,
			event_id: "11155111:claim",
			event_family: "namepass",
			event_type: "CCTPClaimed",
			contract_address: helper,
			nonce: hash,
			wallet_address: wallet,
			source_domain: "6",
			burn_amount: "5000000",
			fee_executed: "0",
			minted_amount: "5000000",
		},
		{
			...hubCommon,
			event_id: "11155111:renewed",
			event_family: "namepass",
			event_type: "Renewed",
			contract_address: helper,
			label_hash: hash,
			wallet_address: wallet,
			executor_address: "0x0000000000000000000000000000000000000001",
			label: "vitalik",
			duration: "31536000",
			amount_received: "5000000",
			gas_allowance: "100000",
			amount_applied: "4900000",
			remainder: "0",
			from_cctp: "true",
		},
		{
			...hubCommon,
			event_id: "11155111:ens",
			event_family: "ens",
			event_type: "NameRenewed",
			contract_address: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
			token_id: "1",
			label: "vitalik",
			duration: "31536000",
			new_expiry: "2000000000",
			payment_token: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
			referrer: hash,
			amount: "4900000",
		},
	];

	for (const event of events) assert.equal(parseGoldskyEvent(event).eventId, event.event_id);
	const renewed = parseGoldskyEvent(events[3]!);
	assert.equal(renewed.facts.amount_applied, "4900000");
});

test("protocol events route to renewal and ENS projections", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(store, async () => {}, () => secret, undefined, async () => "2000000000");
	const common = {
		chain_id: 11155111,
		block_number: 10,
		block_time: 1_723_372_800,
		tx_hash: `0x${"4".repeat(64)}`,
		log_index: 1,
		_gs_op: "c",
	};
	const renewed = {
		...common,
		event_id: "11155111:renewed-route",
		event_family: "namepass",
		event_type: "Renewed",
		contract_address: "0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f",
		label_hash: `0x${"2".repeat(64)}`,
		wallet_address: recipient,
		executor_address: "0x0000000000000000000000000000000000000001",
		label: "vitalik",
		duration: "31536000",
		amount_received: "5000000",
		gas_allowance: "100000",
		amount_applied: "4900000",
		remainder: "0",
		from_cctp: "false",
	};
	const ens = {
		...common,
		event_id: "11155111:ens-route",
		event_family: "ens",
		event_type: "NameRenewed",
		log_index: 2,
		contract_address: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
		token_id: "1",
		label: "vitalik",
		duration: "31536000",
		new_expiry: "2000000000",
		payment_token: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
		referrer: `0x${"2".repeat(64)}`,
		amount: "4900000",
	};

	assert.equal((await route.fetch(request(JSON.stringify(renewed)))).status, 200);
	assert.equal((await route.fetch(request(JSON.stringify(ens)))).status, 200);
	assert.equal(store.renewalReconciliations, 1);
	assert.equal(store.renewalAggregateRefreshes, 1);
	assert.equal(store.expiryRefreshes, 1);
	assert.equal(store.settlementLocks, 2);
});

test("ENS renewal projection identifies the name by canonical label, not mutable token ID", () => {
	assert.equal(ensRenewalLabel({ label: "vitalik", token_id: "1" }), "vitalik");
	assert.equal(ensRenewalLabel({ label: "VITALIK", token_id: "2" }), undefined);
	assert.equal(ensRenewalLabel({ label: "sub.vitalik", token_id: "3" }), undefined);
});

test("external renewal projection requires an exact CCTP source domain", () => {
	const facts = {
		from_cctp: "true",
		amount_received: "4900000",
		remainder: "100000",
		gas_allowance: "100000",
		amount_applied: "4800000",
		duration: "31536000",
	};
	assert.equal(externalRenewalProjection(facts), undefined);
	assert.equal(externalRenewalProjection(facts, {
		source_domain: "999",
		nonce: `0x${"1".repeat(64)}`,
	}), undefined);
	const projection = externalRenewalProjection(facts, {
		source_domain: "6",
		nonce: `0x${"1".repeat(64)}`,
		burn_amount: "5000000",
	});
	assert.equal(projection?.originChainId, "84532");
	assert.equal(projection?.amountProcessed, "5000000");
	assert.equal(externalRenewalProjection({ ...facts, from_cctp: "false" })?.originChainId, "11155111");
});

test("an external settlement patch preserves source provenance and origin remainder", () => {
	const projection = externalRenewalProjection({
		from_cctp: "true",
		remainder: "9",
		gas_allowance: "100000",
		amount_applied: "4800000",
		duration: "31536000",
	}, {
		source_domain: "6",
		nonce: `0x${"1".repeat(64)}`,
		burn_amount: "5000000",
	})!;
	const patch = externalSettlementPatch(projection, "renewal", new Date(0), null);
	assert.equal("trigger" in patch, false);
	assert.equal("amountDetected" in patch, false);
	assert.equal("remainingAmount" in patch, false);
});

test("a settlement reorg resumes the exact transaction stage", () => {
	assert.equal(reorgResumeStatus("origin_renew"), "waiting_origin");
	assert.equal(reorgResumeStatus("claim"), "waiting_claim");
});

test("a late origin webhook does not rewind a released CCTP flow", () => {
	assert.equal(originBurnReconciliationStatus("waiting_origin"), "waiting_origin");
	assert.equal(originBurnReconciliationStatus("waiting_attestation"), "waiting_attestation");
	assert.equal(originBurnReconciliationStatus("waiting_claim"), "waiting_claim");
	assert.equal(originBurnReconciliationStatus("unclaimed"), "unclaimed");
});

test("bytes32 event fields accept Goldsky's bare hex and normalize to 0x", () => {
	// Real payloads captured from the Goldsky webhook: `_gs_log_decode` returns
	// bytes32 params (label_hash, nonce) as bare 64-hex, while addresses keep 0x.
	const renewed = parseGoldskyEvent({
		event_id: "11155111:log_0xfd28bdbfca5529d2789eff8bfd08760357e7c6051090b1f1b94e242124de59b8_94",
		event_family: "namepass",
		event_type: "Renewed",
		chain_id: 11155111,
		block_number: 11514817,
		block_time: 1787052840,
		tx_hash: "0x5b564d19f06f8ad36bd3e682bc5502d041514f818b74cf61d223548a80309dbc",
		log_index: 94,
		contract_address: "0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f",
		label_hash: "e9cc90d595d428aa07c91e6ff64a1eb5ccd8cb9490ebba9e4d30eb20e822c443",
		wallet_address: "0xaf34cb930f362be3fd07fbc837be56ee2f257ddd",
		executor_address: "0xd3f6f8f45f1cc6dca75b918311302e852d268d9c",
		label: "namepass",
		duration: "114102683",
		amount_received: "20000000",
		gas_allowance: "100000",
		amount_applied: "19900000",
		remainder: "0",
		from_cctp: "true",
		_gs_op: "i",
	});
	assert.equal(renewed.facts.label_hash, "0xe9cc90d595d428aa07c91e6ff64a1eb5ccd8cb9490ebba9e4d30eb20e822c443");

	const claimed = parseGoldskyEvent({
		event_id: "11155111:log_0x2f4bf716db37503cbc71aa56bf279604031ffe48b67c185cf118c660680d5588_288",
		event_family: "namepass",
		event_type: "CCTPClaimed",
		chain_id: 11155111,
		block_number: 11514925,
		block_time: 1787054196,
		tx_hash: "0x2f4bf716db37503cbc71aa56bf279604031ffe48b67c185cf118c660680d5588",
		log_index: 288,
		contract_address: "0x39351C9f9eAb6093eFB4e865a6330ECd2a756F0f",
		nonce: "9c56f340be94d5291d773298b09f7a5b18c4fff2802b3a35bddf6d3609e6843c",
		wallet_address: "0xaf34cb930f362be3fd07fbc837be56ee2f257ddd",
		source_domain: "6",
		burn_amount: "10000000",
		fee_executed: "0",
		minted_amount: "10000000",
		_gs_op: "i",
	});
	assert.equal(claimed.facts.nonce, "0x9c56f340be94d5291d773298b09f7a5b18c4fff2802b3a35bddf6d3609e6843c");
	// The normalized nonce must be BigInt-parseable (externalRenewalProjection needs it).
	assert.equal(BigInt(String(claimed.facts.nonce)) > 0n, true);
});

for (const [label, body, code] of [
 ["unknown fields", JSON.stringify({ ...transfer(), added_column: "private payload text" }), "invalid_goldsky_event"],
 ["malformed JSON", "{not-json", "invalid_json"],
 ["non-object JSON", "[]", "invalid_request"],
 ["oversize body", "x".repeat(8193), "body_too_large"],
] as const) {
 test(`authenticated ${label} retain bounded rejection evidence without stopping later events`, async () => {
  const store = new MemoryStore();
  const route = goldskyHandler(store, async () => {}, () => secret);
  const warnings: string[] = [];
  const previous = console.warn;
  console.warn = message => { warnings.push(String(message)); };
  try {
   const result = await route.fetch(request(body));
   assert.equal(result.status, 200);
   assert.equal((await result.json()).skipped, true);
   const evidence = JSON.parse(warnings[0]!);
   assert.equal(evidence.errorCode, code);
   assert.equal(evidence.payloadHashScope, label === "oversize body" ? "first_8192_bytes" : "complete_body");
   const { createHash } = await import("node:crypto");
   assert.equal(evidence.payloadHash, createHash("sha256").update(body.slice(0, 8192)).digest("hex"));
   assert.ok(!warnings[0]!.includes("private payload text"));
   assert.ok(!warnings[0]!.includes(secret));
   assert.equal(store.events.size, 0);
   assert.equal((await route.fetch(request(JSON.stringify(transfer())))).status, 200);
   assert.equal(store.events.size, 1);
  } finally { console.warn = previous; }
 });
}

test("unauthenticated invalid JSON is rejected before rejection evidence is logged", async () => {
 const warnings: string[] = [];
 const previous = console.warn;
 console.warn = message => { warnings.push(String(message)); };
 try {
  const route = goldskyHandler(new MemoryStore(), async () => {}, () => secret);
  assert.equal((await route.fetch(request("{invalid", "wrong-secret"))).status, 401);
  assert.equal(warnings.length, 0);
 } finally { console.warn = previous; }
});
