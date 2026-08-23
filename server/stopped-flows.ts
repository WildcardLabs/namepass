import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { minimumTriggerAmount } from "./config";
import { database } from "./db/client";
import { flows, flowTransitions } from "./db/schema";

export const STOPPED_DEPOSIT_ERROR = "empty_wallet";
export const STOPPED_FLOW_STATUSES = ["cancelled", "failed"] as const;

/** Use the durable transition reason for rows created before last_error_code was populated. */
export function stoppedFlowReason() {
	return sql<string | null>`coalesce(
		${flows.lastErrorCode},
		(select ${flowTransitions.reasonCode}
			from ${flowTransitions}
			where ${flowTransitions.flowId} = ${flows.id}
			order by ${flowTransitions.createdAt} desc
			limit 1)
	)`;
}

export function stoppedDepositFlowCandidate() {
	return and(
		inArray(flows.status, [...STOPPED_FLOW_STATUSES]),
		isNull(flows.originTxIntentId),
		isNull(flows.renewalEventId),
		eq(stoppedFlowReason(), STOPPED_DEPOSIT_ERROR),
	);
}

export function stoppedFlowRecoveryAction(input: {
	chainId: number;
	balance: bigint;
	amountDetected: string;
	depositAmount: string;
}): "none" | "resume_original" | "create_unlinked" {
	if (input.balance < minimumTriggerAmount(input.chainId)) return "none";
	const detected = BigInt(input.amountDetected);
	const deposited = BigInt(input.depositAmount);
	return input.balance === detected && detected === deposited
		? "resume_original"
		: "create_unlinked";
}

/** Queue the same safe flow. Keep its deposit link and its previous Workflow owner for validation. */
export async function queueStoppedFlow(
	flow: typeof flows.$inferSelect,
	actor: "api" | "cron" | "webhook",
): Promise<boolean> {
	const now = new Date();
	return database().transaction(async (tx) => {
		const [queued] = await tx.update(flows).set({
			status: "queued",
			holdReason: null,
			lastErrorCode: null,
			lastErrorDetail: null,
			nextActionAt: null,
			queuedAt: now,
			cancelledAt: null,
			failedAt: null,
			updatedAt: now,
		}).where(and(
			eq(flows.id, flow.id),
			eq(flows.status, flow.status),
			inArray(flows.status, [...STOPPED_FLOW_STATUSES]),
			isNull(flows.originTxIntentId),
			isNull(flows.renewalEventId),
		)).returning({ id: flows.id });
		if (!queued) return false;
		await tx.insert(flowTransitions).values({
			flowId: flow.id,
			fromStatus: flow.status,
			toStatus: "queued",
			actor,
			reasonCode: actor === "api" ? "manual_resume" : "automatic_resume",
		});
		return true;
	});
}
