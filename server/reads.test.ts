import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { indexedBalanceAmount, publicDepositView, publicFlowView, publicNameView, publicRenewalView, recoveredDepositMatches } from "./reads";
import type { chainEvents, deposits, flows, names } from "./db/schema";

test("public read models do not import chain RPC", () => {
	const source = readFileSync(new URL("./reads.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /from "\.\/chain"/);
});

test("indexed balances apply canonical deposits and processing after the snapshot", () => {
	assert.equal(indexedBalanceAmount("250000", "250000", "0"), "500000");
	assert.equal(indexedBalanceAmount("500000", "100000", "600000"), "0");
	assert.equal(indexedBalanceAmount("0", "100000", "200000"), null);
});

test("public flow data excludes internal execution and error detail", () => {
	const now = new Date("2026-08-11T12:00:00.000Z");
	const flow = {
		id: "00000000-0000-4000-8000-000000000001",
		originChainId: "84532",
		trigger: "automatic",
		status: "queued",
		holdReason: null,
		amountDetected: "500000",
		amountProcessed: null,
		remainingAmount: null,
		gasAllowance: null,
		amountApplied: null,
		durationSeconds: null,
		cctpNonce: null,
		lastErrorCode: "temporary_failure",
		nextActionAt: null,
		queuedAt: now,
		heldAt: null,
		unclaimedAt: null,
		settledAt: null,
		cancelledAt: null,
		failedAt: null,
		createdAt: now,
		updatedAt: now,
		workflowRunId: "internal-run",
		lastErrorDetail: "private provider response",
		currentRawTransaction: "0xsigned",
	} as unknown as typeof flows.$inferSelect;
	const result = publicFlowView(flow);

	assert.equal(result.lastErrorCode, "temporary_failure");
	assert.equal("workflowRunId" in result, false);
	assert.equal("lastErrorDetail" in result, false);
	assert.equal("currentRawTransaction" in result, false);
	assert.deepEqual(result.evidence, {
		depositTxHash: null,
		originTxHash: null,
		claimTxHash: null,
		renewalTxHash: null,
		executorAddress: null,
		executorIsRelayer: false,
	});
});

test("public flow evidence contains only public transaction and executor data", () => {
	const flow = { id: "00000000-0000-4000-8000-000000000001" } as typeof flows.$inferSelect;
	const result = publicFlowView(flow, {
		depositTxHash: `0x${"0".repeat(64)}`,
		originTxHash: `0x${"1".repeat(64)}`,
		claimTxHash: null,
		renewalTxHash: `0x${"2".repeat(64)}`,
		executorAddress: "0x0000000000000000000000000000000000000001",
		executorIsRelayer: false,
	});
	assert.equal(result.evidence.depositTxHash, `0x${"0".repeat(64)}`);
	assert.equal(result.evidence.executorAddress, "0x0000000000000000000000000000000000000001");
	assert.equal(result.evidence.executorIsRelayer, false);
	assert.equal("currentRawTransaction" in result.evidence, false);
	assert.equal("workflowRunId" in result.evidence, false);
});

test("public deposit data removes its internal name ID and checksums addresses", () => {
	const result = publicDepositView({
		eventId: "84532:deposit:1",
		nameId: "00000000-0000-4000-8000-000000000001",
		chainId: "84532",
		tokenAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
		senderAddress: "0x0000000000000000000000000000000000000001",
		amount: "500000",
		txHash: `0x${"1".repeat(64)}`,
		logIndex: 0,
		blockNumber: "1",
		blockTime: new Date("2026-08-11T12:00:00.000Z"),
		source: "goldsky",
		status: "finalized",
	} as typeof deposits.$inferSelect);

	assert.equal("nameId" in result, false);
	assert.equal(result.tokenAddress, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
});

test("public name data checksums its lowercase database address", () => {
	const result = publicNameView({
		normalizedLabel: "vitalik",
		displayName: "vitalik.eth",
		depositAddress: "0x043c184003266644372ba5fa4946777b3f1cfc3d",
		activatedAt: new Date("2026-08-11T12:00:00.000Z"),
		currentExpiry: null,
		renewableBy: null,
		ensSyncedAt: new Date("2026-08-11T12:00:00.000Z"),
		unscannedChainIds: [],
		lifetimeReceived: "0",
		lifetimeApplied: "0",
		timeDeliveredSeconds: "0",
		renewalCount: 0n,
	} as unknown as typeof names.$inferSelect);

	assert.equal(result.depositAddress, "0x043c184003266644372bA5fA4946777b3f1cFC3D");
});

test("public renewal data uses permanent facts after raw payload expiry", () => {
	const now = new Date("2026-08-11T12:00:00.000Z");
	const result = publicRenewalView({
		eventId: "11155111:renewed:1",
		eventFamily: "namepass",
		eventType: "Renewed",
		chainId: "11155111",
		txHash: `0x${"2".repeat(64)}`,
		logIndex: 1,
		blockNumber: "1",
		blockTime: now,
		gsOp: "c",
		canonical: true,
		facts: {
			executor_address: "0x0000000000000000000000000000000000000001",
			amount_received: "5000000",
			gas_allowance: "100000",
			amount_applied: "4900000",
			duration: "31536000",
			from_cctp: "false",
		},
		payload: null,
		payloadExpiresAt: null,
		firstSeenAt: now,
		lastSeenAt: now,
	} as typeof chainEvents.$inferSelect, {
		id: "00000000-0000-4000-8000-000000000001",
		originChainId: "11155111",
	} as typeof flows.$inferSelect, null, { new_expiry: "2000000000" }, null, null);

	assert.equal(result.amountApplied, "4900000");
	assert.equal(result.expiryAfter, "2033-05-18T03:33:20.000Z");
	assert.equal(result.executorAddress, "0x0000000000000000000000000000000000000001");
	assert.equal(result.funderUnavailableReason, "deposit_not_linked");
	const accumulated = publicRenewalView(
		{
			eventId: "11155111:renewed:accumulated",
			txHash: `0x${"4".repeat(64)}`,
			blockTime: now,
			facts: {
				executor_address: "0x0000000000000000000000000000000000000001",
				amount_received: "5000000",
				gas_allowance: "100000",
				amount_applied: "4900000",
				duration: "31536000",
				from_cctp: "false",
			},
		} as typeof chainEvents.$inferSelect,
		{ id: "accumulated", originChainId: "11155111", trigger: "automatic", depositEventId: null } as typeof flows.$inferSelect,
		null,
		null,
		null,
		null,
	);
	assert.equal(accumulated.funderUnavailableReason, "multiple_deposits");
});

test("public renewal data uses the receipt expiry when the indexer event is late", () => {
	const now = new Date("2026-08-11T12:00:00.000Z");
	const event = {
		eventId: "11155111:renewed:2",
		txHash: `0x${"3".repeat(64)}`,
		blockTime: now,
		facts: {
			executor_address: "0x0000000000000000000000000000000000000001",
			amount_received: "5000000",
			gas_allowance: "100000",
			amount_applied: "4900000",
			duration: "31536000",
			from_cctp: "false",
		},
	} as typeof chainEvents.$inferSelect;
	const flow = {
		id: "00000000-0000-4000-8000-000000000002",
		originChainId: "11155111",
		expiryAfter: new Date("2033-05-18T03:33:20.000Z"),
	} as typeof flows.$inferSelect;

	assert.equal(publicRenewalView(event, flow, null, null, null, null).expiryAfter, "2033-05-18T03:33:20.000Z");
});

test("a completed CCTP renewal exposes the mined claim attempt", () => {
	const mined = `0x${"7".repeat(64)}`;
	const replacement = `0x${"8".repeat(64)}`;
	const result = publicRenewalView({
		eventId: "11155111:renewed:replacement",
		txHash: mined,
		blockTime: new Date("2026-08-11T12:00:00.000Z"),
		facts: {
			executor_address: "0x0000000000000000000000000000000000000001",
			amount_received: "5000000",
			gas_allowance: "100000",
			amount_applied: "4900000",
			duration: "31536000",
			from_cctp: "true",
		},
	} as typeof chainEvents.$inferSelect, {
		id: "00000000-0000-4000-8000-000000000003",
		originChainId: "84532",
	} as typeof flows.$inferSelect, null, null, null, replacement);

	assert.equal(result.claimTxHash, mined);
});

test("recovered activity accepts only one exact stopped deposit", () => {
	const target = {
		flowId: "manual",
		nameId: "name",
		originChainId: "84532",
		amountReceived: "20000000",
		createdAt: new Date("2026-08-21T12:05:00.000Z"),
	};
	const candidate = {
		flowId: "automatic",
		nameId: "name",
		originChainId: "84532",
		amountDetected: "20000000",
		depositAmount: "20000000",
		createdAt: new Date("2026-08-21T12:00:00.000Z"),
	};
	assert.equal(recoveredDepositMatches(target, candidate), true);
	assert.equal(recoveredDepositMatches(target, { ...candidate, depositAmount: "10000000" }), false);
	assert.equal(recoveredDepositMatches(target, { ...candidate, originChainId: "421614" }), false);
});
