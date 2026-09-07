import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";

import { cronAuthorized } from "./cron";
import * as schema from "./db/schema";
import {
	dueHeldNameRecoveryCandidate,
	overdueUnclaimedRecoveryCandidate,
	processRecoveryBatch,
	resumableRecoveryCandidate,
	retentionBatchLimit,
	STARTING_STALE_MS,
	transactionMonitorCandidatesSql,
} from "./operations";
import { RAW_PAYLOAD_RETENTION_MS, rawPayloadExpiresAt } from "./retention";
import { stoppedFlowRecoveryAction } from "./stopped-flows";

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
	const rechecked: string[] = [];
	const actions = {
		async startFlow(id: string) { started.add(id); },
		async recheckHeldFlow(id: string) { rechecked.push(id); },
		async scanName(name: { id: string }) { scans.push(name.id); return ["flow-from-scan"]; },
		async monitorIntent(id: string) { broadcasts.push(id); },
	};
	const batch = {
		resumableFlowIds: ["queued", "shared"],
		overdueUnclaimedFlowIds: ["overdue", "shared"],
		dueHeldFlowIds: ["held-name"],
		unscannedNames: [{
			id: "name-1",
			depositAddress: "0x0",
			requests: [{ chainId: 84532, version: 1n, requestedThroughBlock: "10" }],
		}],
		monitoredIntents: [{
			id: "intent-1",
			flowId: "queued",
			chainId: 84532,
			status: "prepared",
			broadcastAt: null,
		}],
	};
	const [first, second] = await Promise.all([
		processRecoveryBatch(batch, actions),
		processRecoveryBatch(batch, actions),
	]);
	assert.equal(first.failed, 0);
	assert.equal(second.failed, 0);
	assert.equal(first.dueHeldFlows, 1);
	assert.equal(second.dueHeldFlows, 1);
	assert.equal(first.monitoredIntents, 1);
	assert.equal(first.unbroadcastIntents, 1);
	assert.deepEqual([...started].sort(), ["flow-from-scan", "overdue", "queued", "shared"]);
	assert.deepEqual(rechecked, ["held-name", "held-name"]);
	assert.deepEqual(scans, ["name-1", "name-1"]);
	assert.deepEqual(broadcasts, ["intent-1", "intent-1"]);
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
	const held = db.select().from(schema.flows).where(dueHeldNameRecoveryCandidate(now)).toSQL();
	const stale = new Date(now.getTime() - STARTING_STALE_MS).toISOString();
	assert.ok(resumable.params.includes("queued"));
	assert.ok(resumable.params.includes("waiting_origin"));
	assert.ok(resumable.params.includes("waiting_claim"));
	assert.ok(!resumable.params.includes("cancelled"));
	assert.ok(!resumable.params.includes("empty_wallet"));
	assert.ok(unclaimed.params.includes("unclaimed"));
	assert.ok(held.params.includes("held"));
	assert.ok(held.params.includes("name_not_renewable"));
	assert.ok(held.params.includes(now.toISOString()));
	assert.ok(resumable.params.includes(stale));
	assert.ok(unclaimed.params.includes(stale));
	assert.ok(unclaimed.params.includes(now.toISOString()));
});

test("the transaction monitor selects only the lowest nonce in each sender queue", () => {
	const query = new PgDialect().sqlToQuery(transactionMonitorCandidatesSql(10));
	assert.match(query.sql, /distinct on \(chain_id, lower\(from_address\)\)/);
	assert.match(query.sql, /status in \('prepared', 'broadcast'\)/);
	assert.match(query.sql, /order by chain_id, lower\(from_address\), nonce/);
	assert.equal(query.params[query.params.length - 1], 10);
});

test("stopped-flow recovery keeps exact deposit evidence and rejects false attribution", () => {
	assert.equal(stoppedFlowRecoveryAction({
		chainId: 84532,
		balance: 20_000_000n,
		amountDetected: "20000000",
		depositAmount: "20000000",
	}), "resume_original");
	assert.equal(stoppedFlowRecoveryAction({
		chainId: 84532,
		balance: 30_000_000n,
		amountDetected: "20000000",
		depositAmount: "20000000",
	}), "create_unlinked");
	assert.equal(stoppedFlowRecoveryAction({
		chainId: 84532,
		balance: 100_000n,
		amountDetected: "20000000",
		depositAmount: "20000000",
	}), "none");
});
