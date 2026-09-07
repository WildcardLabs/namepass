import { and, desc, eq, gte, inArray, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { readEnsState, readNativeUsdcBalanceSnapshots, ensNamehash, labelHash } from "./chain";
import { balanceScanCanComplete, requestBalanceScanSql } from "./balance-scan";
import { database } from "./db/client";
import { balanceScanRequests, balanceSnapshots, deposits, flows, names, transactionIntents, watchedAddresses } from "./db/schema";
import { minimumTriggerAmount } from "./config";
import { ApiError } from "./http";
import type { ActivityCursor } from "./http";
import { logOperation } from "./log";
import { recheckHeldNameFlow } from "./operations";
import { publicBalances, publicFlowView, publicNameView, renewalActivity } from "./reads";
import { reconcileStoredRenewals } from "./goldsky";
import { SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress, InvalidLabelError, normalizeLabel } from "../src/lib/namepass";
import { STOPPED_FLOW_STATUSES, stoppedFlowReason } from "./stopped-flows";
import { startRenewalWorkflow } from "./workflows";

const TERMINAL_FLOW_STATUSES = ["settled", "cancelled", "failed"] as Array<typeof flows.$inferSelect.status>;
const STOPPED_FLOW_VISIBILITY_MS = 30 * 24 * 60 * 60 * 1_000;
const HIDDEN_DUPLICATE_ERRORS = new Set([
	"duplicate_message_settled",
	"duplicate_flow_merged",
	"duplicate_flow_repaired",
	"absorbed_by_prior_flow",
]);

export type NameFlowRow = {
	flow: typeof flows.$inferSelect;
	depositTxHash: string | null;
	originTxHash: string | null;
	claimTxHash: string | null;
	reasonCode: string | null;
};

async function recentNameFlows(nameId: string): Promise<NameFlowRow[]> {
	const originIntent = alias(transactionIntents, "visible_name_origin_intent");
	const claimIntent = alias(transactionIntents, "visible_name_claim_intent");
	return database().select({
		flow: flows,
		depositTxHash: deposits.txHash,
		originTxHash: sql<string | null>`coalesce(${flows.originEvidenceTxHash}, ${originIntent.currentTxHash})`,
		claimTxHash: claimIntent.currentTxHash,
		reasonCode: stoppedFlowReason(),
	}).from(flows)
		.leftJoin(deposits, eq(flows.depositEventId, deposits.eventId))
		.leftJoin(originIntent, eq(flows.originTxIntentId, originIntent.id))
		.leftJoin(claimIntent, eq(flows.claimTxIntentId, claimIntent.id))
		.where(and(
			eq(flows.nameId, nameId),
			or(
				notInArray(flows.status, TERMINAL_FLOW_STATUSES),
				and(
					inArray(flows.status, [...STOPPED_FLOW_STATUSES]),
					gte(flows.updatedAt, new Date(Date.now() - STOPPED_FLOW_VISIBILITY_MS)),
				),
			),
		))
		.orderBy(desc(flows.createdAt))
		.limit(32);
}

export function visibleNameFlows(
	rows: readonly NameFlowRow[],
	balances: readonly { chainId: string; amount: string | null }[],
): NameFlowRow[] {
	const activeChains = new Set(rows
		.filter((row) => !TERMINAL_FLOW_STATUSES.includes(row.flow.status))
		.map((row) => row.flow.originChainId));
	const stoppedChains = new Set<string>();
	return rows.flatMap((row) => {
		if (!STOPPED_FLOW_STATUSES.includes(row.flow.status as "cancelled" | "failed")) return [row];
		if (row.flow.lastErrorCode && HIDDEN_DUPLICATE_ERRORS.has(row.flow.lastErrorCode)) return [];
		const chainId = row.flow.originChainId;
		const balance = balances.find((item) => item.chainId === chainId)?.amount;
		const eligible = balance !== null && balance !== undefined
			&& BigInt(balance) >= minimumTriggerAmount(Number(chainId));
		if (!eligible || !row.reasonCode || activeChains.has(chainId) || stoppedChains.has(chainId)) return [];
		stoppedChains.add(chainId);
		return [{ ...row, flow: { ...row.flow, lastErrorCode: row.flow.lastErrorCode ?? row.reasonCode } }];
	});
}

export function normalizedLabel(input: string): string {
	try {
		return normalizeLabel(input);
	} catch (error) {
		if (error instanceof InvalidLabelError) {
			throw new ApiError(400, "invalid_label", error.message, { problem: error.problem });
		}
		throw error;
	}
}

export async function activateName(input: string) {
	const normalized = normalizedLabel(input);
	const address = depositAddress(normalized).toLowerCase();
	let ens;
	try {
		ens = await readEnsState(normalized);
	} catch {
		logOperation("activation.ens_unavailable", { step: "ens_read", errorCode: "ens_unavailable" });
		throw new ApiError(503, "ens_unavailable", "ENS state is not available. Try again shortly.");
	}

	const db = database();
	const created = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(names)
			.values({
				normalizedLabel: normalized,
				displayName: `${normalized}.eth`,
				labelHash: labelHash(normalized),
				namehash: ensNamehash(normalized),
				depositAddress: address,
				currentExpiry: ens.expiry,
				renewableBy: ens.renewableBy,
				ensSyncedAt: new Date(),
				unscannedChainIds: SERVER_CHAINS.map((chain) => String(chain.chainId)),
			})
			.onConflictDoNothing()
			.returning();
		const row = inserted ?? (await tx.select().from(names).where(eq(names.normalizedLabel, normalized)))[0];
		if (!row) throw new Error("Activation insert did not return a name.");
		if (!inserted) {
			await tx
				.update(names)
				.set({ currentExpiry: ens.expiry, renewableBy: ens.renewableBy, ensSyncedAt: new Date() })
				.where(eq(names.id, row.id));
		}
		await tx
			.insert(watchedAddresses)
			.values({ value: address.toLowerCase() })
			.onConflictDoUpdate({ target: watchedAddresses.value, set: { updatedAt: new Date() } });
		for (const chain of SERVER_CHAINS) {
			await tx.execute(requestBalanceScanSql({ nameId: row.id, chainId: chain.chainId }));
		}
		await tx.update(names).set({
			unscannedChainIds: SERVER_CHAINS.map((chain) => String(chain.chainId)),
		}).where(eq(names.id, row.id));
		const requests = await tx.select({
			chainId: balanceScanRequests.chainId,
			version: balanceScanRequests.version,
			requestedThroughBlock: balanceScanRequests.requestedThroughBlock,
		}).from(balanceScanRequests).where(eq(balanceScanRequests.nameId, row.id));
		return { row, inserted: Boolean(inserted), requests };
	});

	const balances = await readNativeUsdcBalanceSnapshots(address);
	const positiveBalances = balances.filter(
		(balance): balance is Required<typeof balance> =>
			balance.amount !== undefined &&
			balance.blockNumber !== undefined &&
			BigInt(balance.amount) >= minimumTriggerAmount(balance.chainId),
	);

	const recoveryFlowIds = await db.transaction(async (tx) => {
		const flowIds: string[] = [];
		const createdFlowChains = new Set<number>();
		for (const balance of balances) {
			if (balance.amount === undefined || balance.blockNumber === undefined) continue;
			await tx.insert(balanceSnapshots).values({
				nameId: created.row.id,
				chainId: String(balance.chainId),
				amount: balance.amount,
				blockNumber: balance.blockNumber,
				updatedAt: new Date(),
			}).onConflictDoUpdate({
				target: [balanceSnapshots.nameId, balanceSnapshots.chainId],
				set: { amount: balance.amount, blockNumber: balance.blockNumber, updatedAt: new Date() },
			});
		}
		for (const balance of positiveBalances) {
			const [flow] = await tx
				.insert(flows)
				.values({
					nameId: created.row.id,
					originChainId: String(balance.chainId),
					trigger: "recovery",
					status: "queued",
					holdReason: "balance_recovery",
					amountDetected: balance.amount,
				})
				.onConflictDoNothing()
				.returning({ id: flows.id });
			if (flow) {
				flowIds.push(flow.id);
				createdFlowChains.add(balance.chainId);
			}
		}
		for (const request of created.requests) {
			const balance = balances.find((item) => String(item.chainId) === request.chainId);
			if (balance?.amount === undefined || balance.blockNumber === undefined) continue;
			const eligible = BigInt(balance.amount) >= minimumTriggerAmount(balance.chainId);
			if (!balanceScanCanComplete({
				requestedThroughBlock: request.requestedThroughBlock,
				snapshotBlock: balance.blockNumber,
				blockedByFlow: eligible && !createdFlowChains.has(balance.chainId),
			})) continue;
			const [cleared] = await tx.delete(balanceScanRequests).where(and(
				eq(balanceScanRequests.nameId, created.row.id),
				eq(balanceScanRequests.chainId, request.chainId),
				eq(balanceScanRequests.version, request.version),
			)).returning({ chainId: balanceScanRequests.chainId });
			if (!cleared) continue;
			await tx.update(names).set({
				unscannedChainIds: sql`array_remove(${names.unscannedChainIds}, ${request.chainId}::numeric)`,
			}).where(eq(names.id, created.row.id));
		}
		return flowIds;
	});
	await reconcileStoredRenewals(address);
	const starts = await Promise.allSettled(recoveryFlowIds.map((flowId) => startRenewalWorkflow(flowId)));
	for (const [index, result] of starts.entries()) {
		if (result.status === "rejected") {
			logOperation("activation.workflow_start_failed", {
				flowId: recoveryFlowIds[index],
				step: "workflow_start",
				errorCode: "workflow_start_failed",
			});
		}
	}

	const [name] = await db.select().from(names).where(eq(names.id, created.row.id));
	return { name: publicNameView(name), balances, activated: created.inserted };
}

export async function publicName(label: string) {
	const normalized = normalizedLabel(label);
	const db = database();
	const [storedName] = await db.select().from(names).where(eq(names.normalizedLabel, normalized));
	if (!storedName) throw new ApiError(404, "name_not_found", "This name is not activated.");
	let ens;
	try {
		ens = await readEnsState(normalized);
	} catch {
		logOperation("name_lookup.ens_unavailable", { step: "ens_read", errorCode: "ens_unavailable" });
		throw new ApiError(503, "ens_unavailable", "Current ENS state is not available. Try again shortly.");
	}
	const now = new Date();
	const [name] = await db.update(names).set({
		currentExpiry: ens.expiry,
		renewableBy: ens.renewableBy,
		ensSyncedAt: now,
	}).where(eq(names.id, storedName.id)).returning();
	if (!name) throw new Error("The refreshed name does not exist.");
	if (ens.renewableBy) {
		const held = await db.select({ id: flows.id }).from(flows).where(and(
			eq(flows.nameId, name.id),
			eq(flows.status, "held"),
			eq(flows.holdReason, "name_not_renewable"),
		));
		const resumed = await Promise.allSettled(held.map((flow) => recheckHeldNameFlow(flow.id, ens)));
		for (const [index, result] of resumed.entries()) {
			if (result.status === "rejected") {
				logOperation("name_lookup.held_resume_failed", {
					flowId: held[index]?.id,
					step: "workflow_start",
					errorCode: "workflow_start_failed",
				});
			}
		}
	}
	const [flowRows, balances] = await Promise.all([
		recentNameFlows(name.id),
		publicBalances(name.id),
	]);
	const activeFlows = visibleNameFlows(flowRows, balances);
	return {
		name: publicNameView(name),
		activeFlows: activeFlows.map(({ flow, depositTxHash, originTxHash, claimTxHash }) => publicFlowView(flow, {
			depositTxHash,
			originTxHash,
			claimTxHash,
			renewalTxHash: null,
			executorAddress: null,
			executorIsRelayer: false,
		})),
		balances,
	};
}

export async function nameActivity(label: string, limit: number, cursor?: ActivityCursor) {
	const normalized = normalizedLabel(label);
	const db = database();
	const [name] = await db.select().from(names).where(eq(names.normalizedLabel, normalized));
	if (!name) throw new ApiError(404, "name_not_found", "This name is not activated.");
	const renewals = await renewalActivity(limit, cursor, name.id);
	const [flowRows, balances] = await Promise.all([
		recentNameFlows(name.id),
		publicBalances(name.id),
	]);
	const activityFlows = visibleNameFlows(flowRows, balances).slice(0, limit);
	return {
		name: publicNameView(name),
		renewals: renewals.items.map((item) => item.renewal),
		flows: activityFlows.map(({ flow, depositTxHash, originTxHash, claimTxHash }) => publicFlowView(flow, {
			depositTxHash,
			originTxHash,
			claimTxHash,
			renewalTxHash: null,
			executorAddress: null,
			executorIsRelayer: false,
		})),
		balances,
		nextCursor: renewals.nextCursor,
	};
}
