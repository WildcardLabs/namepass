import { eq } from "drizzle-orm";

import { database } from "./db/client";
import { flows, flowTransitions } from "./db/schema";

export type FlowStatus = typeof flows.$inferSelect.status;

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
		const now = new Date();
		const terminalError = reasonCode && (toStatus === "cancelled" || toStatus === "failed")
			? { lastErrorCode: reasonCode }
			: {};
		await tx
			.update(flows)
			.set({ ...terminalError, ...patch, ...statusTime(toStatus, now), status: toStatus, updatedAt: now })
			.where(eq(flows.id, flowId));
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
