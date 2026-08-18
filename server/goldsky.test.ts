import assert from "node:assert/strict";
import test from "node:test";

import {
	goldskyHandler,
	ensTokenLabelHash,
	externalRenewalProjection,
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
		depositEventId: string;
		status: "queued" | "cancelled";
	}> = [];
	depositAggregateRefreshes = 0;
	renewalReconciliations = 0;
	renewalAggregateRefreshes = 0;
	expiryRefreshes = 0;

	async transaction<T>(work: (tx: GoldskyTransaction) => Promise<T>): Promise<T> {
		return work(this);
	}

	async upsertEvent(event: GoldskyEvent): Promise<void> {
		this.events.set(event.eventId, event);
	}

	async nameIdForAddress(address: string): Promise<string | undefined> {
		return address === recipient ? "name-1" : undefined;
	}

	async upsertDeposit(event: GoldskyEvent): Promise<void> {
		this.deposits.set(event.eventId, { status: event.gsOp === "c" ? "detected" : "orphaned" });
	}

	async refreshDepositAggregates(): Promise<void> { this.depositAggregateRefreshes += 1; }

	async reconcileRenewal(): Promise<string | undefined> {
		this.renewalReconciliations += 1;
		return "name-1";
	}

	async refreshRenewalAggregates(): Promise<void> { this.renewalAggregateRefreshes += 1; }

	async refreshEnsExpiry(): Promise<void> { this.expiryRefreshes += 1; }

	async ensureFlow(
		nameId: string,
		chainId: number,
		_amount: string,
		depositEventId: string,
	): Promise<string> {
		const existing = this.flows.find(
			(flow) => flow.nameId === nameId && flow.chainId === chainId && flow.status === "queued",
		);
		if (existing) return existing.id;
		const id = `flow-${this.flows.length + 1}`;
		this.flows.push({ id, nameId, chainId, depositEventId, status: "queued" });
		return id;
	}

	async cancelUnbroadcastFlow(nameId: string, chainId: number): Promise<void> {
		for (const flow of this.flows) {
			if (flow.nameId === nameId && flow.chainId === chainId && flow.status === "queued") {
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
	assert.equal(tooLarge.status, 413);
	assert.equal((await tooLarge.json()).error.code, "body_too_large");
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
	assert.equal(store.depositAggregateRefreshes, 2);
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
	const route = goldskyHandler(store, async (flowId) => void started.push(flowId), () => secret);
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

test("delete is idempotent and replay creates one replacement flow", async () => {
	const store = new MemoryStore();
	const route = goldskyHandler(store, async () => {}, () => secret);

	assert.equal((await route.fetch(request(JSON.stringify(transfer("c"))))).status, 200);
	assert.equal((await route.fetch(request(JSON.stringify(transfer("d"))))).status, 200);
	assert.equal((await route.fetch(request(JSON.stringify(transfer("d"))))).status, 200);
	assert.equal(store.flows.length, 1);
	assert.equal(store.flows[0]?.status, "cancelled");
	assert.equal(store.deposits.get(transfer().event_id)?.status, "orphaned");

	assert.equal((await route.fetch(request(JSON.stringify(transfer("c"))))).status, 200);
	assert.equal(store.flows.length, 2);
	assert.deepEqual(store.flows.map((flow) => flow.status), ["cancelled", "queued"]);
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
	const response = await route.fetch(request(JSON.stringify(body)));
	// A non-retriable 4xx makes Goldsky treat the row as a poison pill and crash the
	// whole pipeline. An invalid event is acknowledged (200) and skipped, not ingested.
	assert.equal(response.status, 200);
	assert.equal((await response.json()).skipped, true);
	assert.equal(store.events.size, 0);
});

test("all protocol event shapes match their registry allowlists", () => {
	const hash = `0x${"2".repeat(64)}`;
	const wallet = recipient;
	const factory = "0xe0b155fdb1104824d7e0568aeafcc52823edd00f";
	const helper = "0xf1b51552098ffa7dc2cd83d0fb6508e57db8acc1";
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
			contract_address: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
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
	const route = goldskyHandler(store, async () => {}, () => secret);
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
		contract_address: "0xf1b51552098ffa7dc2cd83d0fb6508e57db8acc1",
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
		contract_address: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
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
});

test("ENS renewal projection identifies the name by token ID", () => {
	assert.equal(ensTokenLabelHash("1"), `0x${"1".padStart(64, "0")}`);
	assert.throws(() => ensTokenLabelHash((1n << 256n).toString()), /uint256/);
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
	});
	assert.equal(projection?.originChainId, "84532");
	assert.equal(projection?.amountProcessed, "4900000");
	assert.equal(externalRenewalProjection({ ...facts, from_cctp: "false" })?.originChainId, "11155111");
});
