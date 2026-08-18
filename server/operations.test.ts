import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";

import { cronAuthorized } from "./cron";
import * as schema from "./db/schema";
import {
	overdueUnclaimedRecoveryCandidate,
	processRecoveryBatch,
	resumableRecoveryCandidate,
	relayerGasLevel,
	retentionBatchLimit,
	STARTING_STALE_MS,
	transactionUnitWei,
} from "./operations";
import { RAW_PAYLOAD_RETENTION_MS, rawPayloadExpiresAt } from "./retention";

test("raw payload expiry is exactly 30 days", () => {
	const now = new Date("2026-08-11T12:00:00.000Z");
	assert.equal(rawPayloadExpiresAt(now).getTime() - now.getTime(), RAW_PAYLOAD_RETENTION_MS);
	assert.equal(RAW_PAYLOAD_RETENTION_MS, 30 * 24 * 60 * 60 * 1_000);
	assert.equal(retentionBatchLimit(5_000), 500);
	assert.equal(retentionBatchLimit(0), 1);
});

test("recovery repairs queued, overdue, unscanned, and unbroadcast rows without duplicate starts", async () => {
	const started = new Set<string>();
	const broadcasts: string[] = [];
	const scans: string[] = [];
	const actions = {
		async startFlow(id: string) { started.add(id); },
		async scanName(name: { id: string }) { scans.push(name.id); return ["flow-from-scan"]; },
		async broadcastIntent(id: string) { broadcasts.push(id); },
	};
	const batch = {
		resumableFlowIds: ["queued", "shared"],
		overdueUnclaimedFlowIds: ["overdue", "shared"],
		unscannedNames: [{ id: "name-1", depositAddress: "0x0", chainIds: [84532] }],
		unbroadcastIntents: [{ id: "intent-1", flowId: "queued", chainId: 84532 }],
	};
	const [first, second] = await Promise.all([
		processRecoveryBatch(batch, actions),
		processRecoveryBatch(batch, actions),
	]);
	assert.equal(first.failed, 0);
	assert.equal(second.failed, 0);
	assert.deepEqual([...started].sort(), ["flow-from-scan", "overdue", "queued", "shared"]);
	assert.deepEqual(scans, ["name-1", "name-1"]);
	assert.deepEqual(broadcasts, ["intent-1", "intent-1"]);
});

test("gas levels use the configured transaction unit and do not expose balances", () => {
	const previous = process.env.RELAYER_TRANSACTION_UNIT_WEI_BASE;
	process.env.RELAYER_TRANSACTION_UNIT_WEI_BASE = "100";
	try {
		assert.equal(transactionUnitWei("base"), 100n);
		assert.equal(relayerGasLevel(2_001n, 100n), "ok");
		assert.equal(relayerGasLevel(2_000n, 100n), "warning");
		assert.equal(relayerGasLevel(500n, 100n), "critical");
		assert.equal(relayerGasLevel(1n, undefined), "unavailable");
	} finally {
		if (previous === undefined) delete process.env.RELAYER_TRANSACTION_UNIT_WEI_BASE;
		else process.env.RELAYER_TRANSACTION_UNIT_WEI_BASE = previous;
	}
});

test("cron authorization rejects missing and wrong secrets", () => {
	assert.equal(cronAuthorized(null, "test"), false);
	assert.equal(cronAuthorized("Bearer wrong", "test"), false);
	assert.equal(cronAuthorized("Bearer test", "test"), true);
});

test("recovery checks every stale resumable stage and due unclaimed workflow owners", () => {
	const now = new Date("2026-08-11T12:00:00.000Z");
	const db = drizzle.mock({ schema });
	const resumable = db.select().from(schema.flows).where(resumableRecoveryCandidate(now)).toSQL();
	const unclaimed = db.select().from(schema.flows).where(overdueUnclaimedRecoveryCandidate(now)).toSQL();
	const stale = new Date(now.getTime() - STARTING_STALE_MS).toISOString();
	assert.ok(resumable.params.includes("queued"));
	assert.ok(resumable.params.includes("waiting_origin"));
	assert.ok(resumable.params.includes("waiting_claim"));
	assert.ok(resumable.params.includes("cancelled"));
	assert.ok(unclaimed.params.includes("unclaimed"));
	assert.ok(resumable.params.includes(stale));
	assert.ok(unclaimed.params.includes(stale));
	assert.ok(unclaimed.params.includes(now.toISOString()));
});
