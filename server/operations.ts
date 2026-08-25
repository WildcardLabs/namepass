import { and, eq, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import { readEnsState, readNativeUsdcBalanceSnapshots } from "./chain";
import { minimumTriggerAmount } from "./config";
import { withDatabaseLease, database } from "./db/client";
import { balanceSnapshots, chainEvents, flows, flowTransitions, names, transactionIntents } from "./db/schema";
import { NAME_RECHECK_MS } from "./flow-state";
import { logOperation } from "./log";
import { broadcastTransaction } from "./transactions";
import { startRenewalWorkflow } from "./workflows";
import { SERVER_CHAINS } from "../src/lib/chains";

const RECOVERY_LEASE = 0x4e414d45;
const RECOVERY_LIMIT = 10;
const RETENTION_LIMIT = 500;
export const STARTING_STALE_MS = 5 * 60 * 1_000;
const STARTING = "starting:";
const RESUMABLE_FLOW_STATUSES = [
	"queued",
	"confirming_deposit",
	"checking_name",
	"submitting_origin",
	"waiting_origin",
	"waiting_attestation",
	"submitting_claim",
	"waiting_claim",
] as Array<typeof flows.$inferSelect.status>;

export interface RecoveryBatch {
	readonly resumableFlowIds: readonly string[];
	readonly overdueUnclaimedFlowIds: readonly string[];
	readonly dueHeldFlowIds: readonly string[];
	readonly unscannedNames: ReadonlyArray<{ id: string; depositAddress: string; chainIds: readonly number[] }>;
	readonly unbroadcastIntents: ReadonlyArray<{ id: string; flowId: string; chainId: number }>;
}

export interface RecoveryActions {
	startFlow(flowId: string): Promise<unknown>;
	recheckHeldFlow(flowId: string): Promise<unknown>;
	scanName(name: { id: string; depositAddress: string; chainIds: readonly number[] }): Promise<readonly string[]>;
	broadcastIntent(intentId: string): Promise<unknown>;
}

export interface RecoveryReport {
	skipped: boolean;
	/** Kept for monitoring clients that used the original response field. */
	queuedFlows: number;
	resumableFlows: number;
	overdueUnclaimedFlows: number;
	dueHeldFlows: number;
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
	const flowIds = new Set([...batch.resumableFlowIds, ...batch.overdueUnclaimedFlowIds]);
	for (const flowId of flowIds) {
		try {
			await actions.startFlow(flowId);
			logOperation("recovery.flow_started", { flowId, step: "workflow_start" });
		} catch {
			failed += 1;
			logOperation("recovery.flow_failed", { flowId, step: "workflow_start", errorCode: "workflow_start_failed" });
		}
	}
	for (const flowId of batch.dueHeldFlowIds) {
		try {
			await actions.recheckHeldFlow(flowId);
			logOperation("recovery.held_name_rechecked", { flowId, step: "ens_read" });
		} catch {
			failed += 1;
			logOperation("recovery.held_name_failed", { flowId, step: "ens_read", errorCode: "ens_read_failed" });
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
		queuedFlows: batch.resumableFlowIds.length,
		resumableFlows: batch.resumableFlowIds.length,
		overdueUnclaimedFlows: batch.overdueUnclaimedFlowIds.length,
		dueHeldFlows: batch.dueHeldFlowIds.length,
		unscannedNames: batch.unscannedNames.length,
		unbroadcastIntents: batch.unbroadcastIntents.length,
		failed,
	};
}

async function scanUnscannedName(name: { id: string; depositAddress: string; chainIds: readonly number[] }): Promise<readonly string[]> {
	const balances = await readNativeUsdcBalanceSnapshots(name.depositAddress, [...name.chainIds]);
	const answered = new Set(balances
		.filter((balance) => balance.amount !== undefined && balance.blockNumber !== undefined)
		.map((balance) => balance.chainId));
	const remaining = name.chainIds.filter((chainId) => !answered.has(chainId));
	const eligible = balances.filter(
		(balance): balance is Required<typeof balance> =>
			balance.amount !== undefined && BigInt(balance.amount) >= minimumTriggerAmount(balance.chainId),
	);
	const created = await database().transaction(async (tx) => {
		await tx.update(names).set({ unscannedChainIds: remaining.map(String) }).where(eq(names.id, name.id));
		for (const balance of balances) {
			if (balance.amount === undefined || balance.blockNumber === undefined) continue;
			await tx.insert(balanceSnapshots).values({
				nameId: name.id,
				chainId: String(balance.chainId),
				amount: balance.amount,
				blockNumber: balance.blockNumber,
				updatedAt: new Date(),
			}).onConflictDoUpdate({
				target: [balanceSnapshots.nameId, balanceSnapshots.chainId],
				set: { amount: balance.amount, blockNumber: balance.blockNumber, updatedAt: new Date() },
			});
		}
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

export function resumableRecoveryCandidate(now: Date) {
	return and(
		or(
			inArray(flows.status, RESUMABLE_FLOW_STATUSES),
			and(
				eq(flows.status, "cancelled"),
				isNull(flows.renewalEventId),
				sql`exists (
					select 1 from ${transactionIntents}
					where ${transactionIntents.flowId} = ${flows.id}
						and ${transactionIntents.status} <> 'reverted'
				)`,
			),
		),
		or(
			isNull(flows.workflowRunId),
			lte(flows.updatedAt, new Date(now.getTime() - STARTING_STALE_MS)),
		),
	);
}

async function recoverFlow(flowId: string): Promise<void> {
	await startRenewalWorkflow(flowId);
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

export function dueHeldNameRecoveryCandidate(now: Date) {
	return and(
		eq(flows.status, "held"),
		eq(flows.holdReason, "name_not_renewable"),
		or(isNull(flows.nextActionAt), lte(flows.nextActionAt, now)),
	);
}

type EnsState = Awaited<ReturnType<typeof readEnsState>>;

/** Refresh a held name on a bounded backoff. Resume the same flow when ENS accepts it. */
export async function recheckHeldNameFlow(flowId: string, knownEns?: EnsState): Promise<void> {
	const [row] = await database().select({
		flow: flows,
		label: names.normalizedLabel,
		nameId: names.id,
	}).from(flows)
		.innerJoin(names, eq(flows.nameId, names.id))
		.where(and(
			eq(flows.id, flowId),
			knownEns
				? and(eq(flows.status, "held"), eq(flows.holdReason, "name_not_renewable"))
				: dueHeldNameRecoveryCandidate(new Date()),
		));
	if (!row) return;

	const ens = knownEns ?? await readEnsState(row.label);
	const now = new Date();
	const resumed = await database().transaction(async (tx) => {
		await tx.update(names).set({
			currentExpiry: ens.expiry,
			renewableBy: ens.renewableBy,
			ensSyncedAt: now,
		}).where(eq(names.id, row.nameId));
		if (!ens.renewableBy) {
			await tx.update(flows).set({
				nextActionAt: new Date(now.getTime() + NAME_RECHECK_MS),
				updatedAt: now,
			}).where(and(
				eq(flows.id, flowId),
				eq(flows.status, "held"),
				eq(flows.holdReason, "name_not_renewable"),
			));
			return false;
		}
		const [queued] = await tx.update(flows).set({
			status: "queued",
			holdReason: null,
			lastErrorCode: null,
			nextActionAt: null,
			workflowRunId: null,
			queuedAt: now,
			updatedAt: now,
		}).where(and(
			eq(flows.id, flowId),
			eq(flows.status, "held"),
			eq(flows.holdReason, "name_not_renewable"),
		)).returning({ id: flows.id });
		if (!queued) return false;
		await tx.insert(flowTransitions).values({
			flowId,
			fromStatus: "held",
			toStatus: "queued",
			actor: knownEns ? "api" : "cron",
			reasonCode: "name_became_renewable",
		});
		return true;
	});
	if (resumed) await startRenewalWorkflow(flowId);
}

async function recoveryBatch(now: Date): Promise<RecoveryBatch> {
	const db = database();
	const unscanned = await db.select({
		id: names.id,
		depositAddress: names.depositAddress,
		chainIds: names.unscannedChainIds,
	}).from(names).where(or(
		sql`cardinality(${names.unscannedChainIds}) > 0`,
		sql`(select count(*) from ${balanceSnapshots} where ${balanceSnapshots.nameId} = ${names.id}) < ${SERVER_CHAINS.length}`,
	)).limit(RECOVERY_LIMIT);
	const snapshotRows = unscanned.length
		? await db.select({ nameId: balanceSnapshots.nameId, chainId: balanceSnapshots.chainId })
			.from(balanceSnapshots)
			.where(inArray(balanceSnapshots.nameId, unscanned.map((row) => row.id)))
		: [];
	const [resumable, overdueUnclaimed, dueHeld, unbroadcast] = await Promise.all([
		db.select({ id: flows.id }).from(flows).where(resumableRecoveryCandidate(now)).limit(RECOVERY_LIMIT),
		db.select({ id: flows.id }).from(flows).where(overdueUnclaimedRecoveryCandidate(now)).limit(RECOVERY_LIMIT),
		db.select({ id: flows.id }).from(flows).where(dueHeldNameRecoveryCandidate(now)).limit(RECOVERY_LIMIT),
		db.select({ id: transactionIntents.id, flowId: transactionIntents.flowId, chainId: transactionIntents.chainId }).from(transactionIntents).where(and(
			eq(transactionIntents.status, "prepared"),
			isNull(transactionIntents.broadcastAt),
			sql`${transactionIntents.currentRawTransaction} is not null`,
		)).limit(RECOVERY_LIMIT),
	]);
	return {
		resumableFlowIds: resumable.map((row) => row.id),
		overdueUnclaimedFlowIds: overdueUnclaimed.map((row) => row.id),
		dueHeldFlowIds: dueHeld.map((row) => row.id),
		unscannedNames: unscanned.map((row) => {
			const existing = new Set(snapshotRows
				.filter((snapshot) => snapshot.nameId === row.id)
				.map((snapshot) => Number(snapshot.chainId)));
			const requested = new Set(row.chainIds.map(Number).filter(Number.isSafeInteger));
			for (const chain of SERVER_CHAINS) if (!existing.has(chain.chainId)) requested.add(chain.chainId);
			return { id: row.id, depositAddress: row.depositAddress, chainIds: [...requested] };
		}),
		unbroadcastIntents: unbroadcast.map((row) => ({ id: row.id, flowId: row.flowId, chainId: Number(row.chainId) })),
	};
}

/** A marker is not a Workflow run ID. Clear only markers old enough for the next cron to reclaim. */
async function clearStaleStartingMarkers(batch: RecoveryBatch, now: Date): Promise<void> {
	const staleBefore = new Date(now.getTime() - STARTING_STALE_MS);
	const clear = async (flowIds: readonly string[], statuses: readonly (typeof flows.$inferSelect.status)[]) => {
		if (!flowIds.length) return;
		await database().update(flows).set({ workflowRunId: null, updatedAt: now }).where(and(
			inArray(flows.id, [...flowIds]),
			inArray(flows.status, [...statuses]),
			like(flows.workflowRunId, `${STARTING}%`),
			lte(flows.updatedAt, staleBefore),
		));
	};
	await Promise.all([
		clear(batch.resumableFlowIds, [...RESUMABLE_FLOW_STATUSES, "cancelled"]),
		clear(batch.overdueUnclaimedFlowIds, ["unclaimed"]),
	]);
}

/** Repair safe-to-restart rows. The starter verifies stale Workflow owners before replacement. */
export async function recoverOperations(now = new Date()): Promise<RecoveryReport> {
	const report = await withDatabaseLease(RECOVERY_LEASE, async () => {
		const batch = await recoveryBatch(now);
		await clearStaleStartingMarkers(batch, now);
		const repaired = await processRecoveryBatch(batch, {
			startFlow: recoverFlow,
			recheckHeldFlow: recheckHeldNameFlow,
			scanName: scanUnscannedName,
			broadcastIntent: broadcastTransaction,
		});
		return { skipped: false, ...repaired };
	});
	return report ?? {
		skipped: true,
		queuedFlows: 0,
		resumableFlows: 0,
		overdueUnclaimedFlows: 0,
		dueHeldFlows: 0,
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
