import { and, eq, isNull } from "drizzle-orm";

import { database } from "./db/client";
import { flows, flowTransitions } from "./db/schema";

export type FlowStatus = typeof flows.$inferSelect.status;
export const NAME_RECHECK_MS = 5 * 60 * 1_000;
export const ORIGIN_WALLET_ACTIVE_STATUSES: FlowStatus[] = [
	"queued",
	"confirming_deposit",
	"checking_name",
	"submitting_origin",
	"waiting_origin",
	"held",
];

export function originWalletOwnsFlow(status: FlowStatus, originEventId: string | null): boolean {
	return originEventId === null && ORIGIN_WALLET_ACTIVE_STATUSES.includes(status);
}

export function preOriginFlowAction(
	status: FlowStatus,
	hasOriginIntent: boolean,
	expectedStatuses: readonly FlowStatus[],
): "apply" | "ignore" {
	return !hasOriginIntent && expectedStatuses.includes(status) ? "apply" : "ignore";
}

const TERMINAL_STATUSES = new Set<FlowStatus>(["settled", "cancelled", "failed"]);
const FORWARD_RANK: Partial<Record<FlowStatus, number>> = {
	queued: 0,
	confirming_deposit: 1,
	checking_name: 2,
	submitting_origin: 3,
	waiting_origin: 4,
	waiting_attestation: 5,
	submitting_claim: 6,
	waiting_claim: 7,
};

/** Late duplicate steps may update their current stage, but they may not move durable state backwards. */
export function flowTransitionAction(
	fromStatus: FlowStatus,
	toStatus: FlowStatus,
): "apply" | "ignore" {
	if (TERMINAL_STATUSES.has(fromStatus)) return fromStatus === toStatus ? "apply" : "ignore";
	if (fromStatus === toStatus) return "apply";
	if (fromStatus === "held") return "ignore";
	if (fromStatus === "unclaimed") {
		return ["submitting_claim", "waiting_claim", "settled", "failed"].includes(toStatus)
			? "apply"
			: "ignore";
	}
	const fromRank = FORWARD_RANK[fromStatus];
	const toRank = FORWARD_RANK[toStatus];
	if (fromRank !== undefined && toRank !== undefined && toRank < fromRank) return "ignore";
	return "apply";
}

function statusTime(status: FlowStatus, now: Date): Partial<typeof flows.$inferInsert> {
	switch (status) {
		case "confirming_deposit": return { confirmingDepositAt: now };
		case "checking_name": return { checkingNameAt: now };
		case "submitting_origin": return { submittingOriginAt: now };
		case "waiting_origin": return { waitingOriginAt: now };
		case "waiting_attestation": return { waitingAttestationAt: now };
		case "submitting_claim": return { submittingClaimAt: now };
		case "waiting_claim": return { waitingClaimAt: now };
		case "held": return { heldAt: now };
		case "unclaimed": return { unclaimedAt: now };
		case "settled": return { settledAt: now };
		case "cancelled": return { cancelledAt: now };
		case "failed": return { failedAt: now };
		default: return {};
	}
}

export async function setFlowStatus(
	flowId: string,
	toStatus: FlowStatus,
	patch: Partial<typeof flows.$inferInsert> = {},
	reasonCode?: string,
	detail?: Record<string, unknown>,
): Promise<void> {
	await database().transaction(async (tx) => {
		const [flow] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, flowId));
		if (!flow) throw new Error("The flow does not exist.");
		if (flowTransitionAction(flow.status, toStatus) === "ignore") return;
		const now = new Date();
		const terminalError = reasonCode && (toStatus === "cancelled" || toStatus === "failed")
			? { lastErrorCode: reasonCode }
			: {};
		const clearStoppedState = flow.status !== toStatus
			&& !["held", "unclaimed", "cancelled", "failed"].includes(toStatus)
			? { holdReason: null, lastErrorCode: null, lastErrorDetail: null, nextActionAt: null }
			: {};
		const timestamp = flow.status === toStatus ? {} : statusTime(toStatus, now);
		const [updated] = await tx
			.update(flows)
			.set({ ...clearStoppedState, ...terminalError, ...patch, ...timestamp, status: toStatus, updatedAt: now })
			.where(and(eq(flows.id, flowId), eq(flows.status, flow.status)))
			.returning({ id: flows.id });
		if (!updated) return;
		if (flow.status !== toStatus) {
			await tx.insert(flowTransitions).values({
				flowId,
				fromStatus: flow.status,
				toStatus,
				actor: "workflow",
				reasonCode,
				detail,
			});
		}
	});
}

/** Apply a validation result only before an origin transaction exists. */
export async function setPreOriginFlowStatus(
	flowId: string,
	expectedStatuses: readonly FlowStatus[],
	toStatus: "held" | "cancelled",
	patch: Partial<typeof flows.$inferInsert>,
	reasonCode: string,
): Promise<{ applied: boolean; status: FlowStatus }> {
	return database().transaction(async (tx) => {
		const [flow] = await tx.select({
			status: flows.status,
			originTxIntentId: flows.originTxIntentId,
		}).from(flows).where(eq(flows.id, flowId)).for("update");
		if (!flow) throw new Error("The flow does not exist.");
		if (preOriginFlowAction(flow.status, flow.originTxIntentId !== null, expectedStatuses) === "ignore") {
			return { applied: false, status: flow.status };
		}
		const now = new Date();
		const [updated] = await tx.update(flows).set({
			...patch,
			status: toStatus,
			lastErrorCode: reasonCode,
			...statusTime(toStatus, now),
			updatedAt: now,
		}).where(and(
			eq(flows.id, flowId),
			eq(flows.status, flow.status),
			isNull(flows.originTxIntentId),
		)).returning({ id: flows.id });
		if (!updated) return { applied: false, status: flow.status };
		if (flow.status !== toStatus) {
			await tx.insert(flowTransitions).values({
				flowId,
				fromStatus: flow.status,
				toStatus,
				actor: "workflow",
				reasonCode,
			});
		}
		return { applied: true, status: toStatus };
	});
}
