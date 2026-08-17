import { and, eq, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import { readNativeUsdcBalances } from "./chain";
import { minimumTriggerAmount } from "./config";
import { withDatabaseLease, database } from "./db/client";
import { chainEvents, flows, names, transactionIntents } from "./db/schema";
import { logOperation } from "./log";
import { broadcastTransaction, relayerAccount, verifiedChainClient } from "./transactions";
import { startRenewalWorkflow } from "./workflows";
import { chainById, SERVER_CHAINS, type ChainKey } from "../src/lib/chains";

const RECOVERY_LEASE = 0x4e414d45;
const RECOVERY_LIMIT = 10;
const RETENTION_LIMIT = 500;
export const STARTING_STALE_MS = 5 * 60 * 1_000;
const STARTING = "starting:";

export type GasLevel = "ok" | "warning" | "critical" | "unavailable";

export function transactionUnitWei(key: ChainKey): bigint | undefined {
	const value = process.env[`RELAYER_TRANSACTION_UNIT_WEI_${key.toUpperCase()}`];
	return value && /^[1-9][0-9]*$/.test(value) ? BigInt(value) : undefined;
}

export function relayerGasLevel(balance: bigint, unit: bigint | undefined): GasLevel {
	if (!unit || unit <= 0n) return "unavailable";
	if (balance <= unit * 5n) return "critical";
	if (balance <= unit * 20n) return "warning";
	return "ok";
}

export interface RecoveryBatch {
	readonly queuedFlowIds: readonly string[];
	readonly overdueUnclaimedFlowIds: readonly string[];
	readonly unscannedNames: ReadonlyArray<{ id: string; depositAddress: string; chainIds: readonly number[] }>;
	readonly unbroadcastIntents: ReadonlyArray<{ id: string; flowId: string; chainId: number }>;
}

export interface RecoveryActions {
	startFlow(flowId: string): Promise<unknown>;
	scanName(name: { id: string; depositAddress: string; chainIds: readonly number[] }): Promise<readonly string[]>;
	broadcastIntent(intentId: string): Promise<unknown>;
}

export interface RecoveryReport {
	skipped: boolean;
	queuedFlows: number;
	overdueUnclaimedFlows: number;
	unscannedNames: number;
	unbroadcastIntents: number;
	failed: number;
}

/** Execute a bounded, idempotent repair batch. It is small enough to run in a cron invocation. */
export async function processRecoveryBatch(
	batch: RecoveryBatch,
	actions: RecoveryActions,
): Promise<Omit<RecoveryReport, "skipped">> {
	let failed = 0;
	const flowIds = new Set([...batch.queuedFlowIds, ...batch.overdueUnclaimedFlowIds]);
	for (const flowId of flowIds) {
		try {
			await actions.startFlow(flowId);
			logOperation("recovery.flow_started", { flowId, step: "workflow_start" });
		} catch {
			failed += 1;
			logOperation("recovery.flow_failed", { flowId, step: "workflow_start", errorCode: "workflow_start_failed" });
		}
	}
	for (const name of batch.unscannedNames) {
		try {
			const started = await actions.scanName(name);
			for (const flowId of started) await actions.startFlow(flowId);
			logOperation("recovery.name_scanned", { chainId: name.chainIds.join(","), step: "balance_scan" });
		} catch {
			failed += 1;
			logOperation("recovery.name_failed", { chainId: name.chainIds.join(","), step: "balance_scan", errorCode: "balance_scan_failed" });
		}
	}
	for (const intent of batch.unbroadcastIntents) {
		try {
			await actions.broadcastIntent(intent.id);
			logOperation("recovery.intent_rebroadcast", { flowId: intent.flowId, chainId: intent.chainId, step: "broadcast" });
		} catch {
			failed += 1;
			logOperation("recovery.intent_failed", { flowId: intent.flowId, chainId: intent.chainId, step: "broadcast", errorCode: "broadcast_failed" });
		}
	}
	return {
		queuedFlows: batch.queuedFlowIds.length,
		overdueUnclaimedFlows: batch.overdueUnclaimedFlowIds.length,
		unscannedNames: batch.unscannedNames.length,
		unbroadcastIntents: batch.unbroadcastIntents.length,
		failed,
	};
}

async function scanUnscannedName(name: { id: string; depositAddress: string; chainIds: readonly number[] }): Promise<readonly string[]> {
	const balances = await readNativeUsdcBalances(name.depositAddress, [...name.chainIds]);
	const answered = new Set(balances.filter((balance) => balance.amount !== undefined).map((balance) => balance.chainId));
	const remaining = name.chainIds.filter((chainId) => !answered.has(chainId));
	const eligible = balances.filter(
		(balance): balance is Required<typeof balance> =>
			balance.amount !== undefined && BigInt(balance.amount) >= minimumTriggerAmount(balance.chainId),
	);
	const created = await database().transaction(async (tx) => {
		await tx.update(names).set({ unscannedChainIds: remaining.map(String) }).where(eq(names.id, name.id));
		const result: string[] = [];
		for (const balance of eligible) {
			const [flow] = await tx
				.insert(flows)
				.values({
					nameId: name.id,
					originChainId: String(balance.chainId),
					trigger: "recovery",
					status: "queued",
					holdReason: "balance_recovery",
					amountDetected: balance.amount,
				})
				.onConflictDoNothing()
				.returning({ id: flows.id });
			if (flow) result.push(flow.id);
		}
		return result;
	});
	return created;
}

export function queuedRecoveryCandidate(now: Date) {
	return and(
		eq(flows.status, "queued"),
		or(
			isNull(flows.workflowRunId),
			lte(flows.updatedAt, new Date(now.getTime() - STARTING_STALE_MS)),
		),
	);
}

export function overdueUnclaimedRecoveryCandidate(now: Date) {
	return and(
		eq(flows.status, "unclaimed"),
		or(
			isNull(flows.workflowRunId),
			lte(flows.updatedAt, new Date(now.getTime() - STARTING_STALE_MS)),
		),
		lte(flows.nextActionAt, now),
	);
}

async function recoveryBatch(now: Date): Promise<RecoveryBatch> {
	const db = database();
	const [queued, overdueUnclaimed, unscanned, unbroadcast] = await Promise.all([
		db.select({ id: flows.id }).from(flows).where(queuedRecoveryCandidate(now)).limit(RECOVERY_LIMIT),
		db.select({ id: flows.id }).from(flows).where(overdueUnclaimedRecoveryCandidate(now)).limit(RECOVERY_LIMIT),
		db.select({ id: names.id, depositAddress: names.depositAddress, chainIds: names.unscannedChainIds })
			.from(names)
			.where(sql`cardinality(${names.unscannedChainIds}) > 0`)
			.limit(RECOVERY_LIMIT),
		db.select({ id: transactionIntents.id, flowId: transactionIntents.flowId, chainId: transactionIntents.chainId }).from(transactionIntents).where(and(
			eq(transactionIntents.status, "prepared"),
			isNull(transactionIntents.broadcastAt),
			sql`${transactionIntents.currentRawTransaction} is not null`,
		)).limit(RECOVERY_LIMIT),
	]);
	return {
		queuedFlowIds: queued.map((row) => row.id),
		overdueUnclaimedFlowIds: overdueUnclaimed.map((row) => row.id),
		unscannedNames: unscanned.map((row) => ({
			id: row.id,
			depositAddress: row.depositAddress,
			chainIds: row.chainIds.map(Number).filter(Number.isSafeInteger),
		})),
		unbroadcastIntents: unbroadcast.map((row) => ({ id: row.id, flowId: row.flowId, chainId: Number(row.chainId) })),
	};
}

/** A marker is not a Workflow run ID. Clear only markers old enough for the next cron to reclaim. */
async function clearStaleStartingMarkers(batch: RecoveryBatch, now: Date): Promise<void> {
	const staleBefore = new Date(now.getTime() - STARTING_STALE_MS);
	const clear = async (flowIds: readonly string[], status: typeof flows.$inferSelect.status) => {
		if (!flowIds.length) return;
		await database().update(flows).set({ workflowRunId: null, updatedAt: now }).where(and(
			inArray(flows.id, [...flowIds]),
			eq(flows.status, status),
			like(flows.workflowRunId, `${STARTING}%`),
			lte(flows.updatedAt, staleBefore),
		));
	};
	await Promise.all([
		clear(batch.queuedFlowIds, "queued"),
		clear(batch.overdueUnclaimedFlowIds, "unclaimed"),
	]);
}

/** Repair safe-to-restart rows. The starter verifies stale Workflow owners before replacement. */
export async function recoverOperations(now = new Date()): Promise<RecoveryReport> {
	const report = await withDatabaseLease(RECOVERY_LEASE, async () => {
		const batch = await recoveryBatch(now);
		await clearStaleStartingMarkers(batch, now);
		const repaired = await processRecoveryBatch(batch, {
			startFlow: startRenewalWorkflow,
			scanName: scanUnscannedName,
			broadcastIntent: broadcastTransaction,
		});
		return { skipped: false, ...repaired };
	});
	return report ?? {
		skipped: true,
		queuedFlows: 0,
		overdueUnclaimedFlows: 0,
		unscannedNames: 0,
		unbroadcastIntents: 0,
		failed: 0,
	};
}

/** Remove only expired raw payloads. Normalized event columns and event rows remain. */
export async function deleteExpiredPayloads(now = new Date(), limit = RETENTION_LIMIT): Promise<number> {
	const bounded = retentionBatchLimit(limit);
	const result = await database().execute<{ event_id: string }>(sql`
		with expired as (
			select ${chainEvents.eventId}
			from ${chainEvents}
			where ${chainEvents.payload} is not null and ${chainEvents.payloadExpiresAt} <= ${now}
			order by ${chainEvents.payloadExpiresAt}
			limit ${bounded}
			for update skip locked
		)
		update ${chainEvents}
		set payload = null, payload_expires_at = null
		where ${chainEvents.eventId} in (select event_id from expired)
		returning ${chainEvents.eventId}
	`);
	return result.rows.length;
}

export function retentionBatchLimit(limit: number): number {
	return Math.min(Math.max(Math.floor(limit), 1), RETENTION_LIMIT);
}

export type OperationsHealth = {
	database: "ok" | "unavailable";
	chains: Array<{ chainId: number; gas: GasLevel }>;
};

/** Return operational state without returning database URLs, keys, addresses, or balances. */
export async function operationsHealth(): Promise<OperationsHealth> {
	let databaseStatus: OperationsHealth["database"] = "ok";
	try {
		await database().execute(sql`select 1`);
	} catch {
		databaseStatus = "unavailable";
		logOperation("operations.database_failed", { step: "health", errorCode: "database_unavailable" });
	}

	let account: ReturnType<typeof relayerAccount> | undefined;
	try {
		account = relayerAccount();
	} catch {
		// A missing key is shown as unavailable, never as configuration detail.
	}
	const chains = await Promise.all(SERVER_CHAINS.map(async (chain) => {
		try {
			if (!account) return { chainId: chain.chainId, gas: "unavailable" as const };
			const definition = chainById(chain.chainId);
			if (!definition) throw new Error("Unsupported chain.");
			const client = await verifiedChainClient(definition);
			const balance = await client.getBalance({ address: account.address });
			const gas = relayerGasLevel(balance, transactionUnitWei(chain.key));
			logOperation("operations.relayer_gas", { chainId: chain.chainId, step: "health", errorCode: gas === "ok" ? undefined : `gas_${gas}` });
			return { chainId: chain.chainId, gas };
		} catch {
			logOperation("operations.rpc_failed", { chainId: chain.chainId, step: "health", errorCode: "rpc_unavailable" });
			return { chainId: chain.chainId, gas: "unavailable" as const };
		}
	}));
	return { database: databaseStatus, chains };
}
