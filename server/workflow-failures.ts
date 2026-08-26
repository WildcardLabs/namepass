import { and, eq, notInArray } from "drizzle-orm";

import { database } from "./db/client";
import { flows, flowTransitions } from "./db/schema";

const RETRY_DELAY_MS = 60_000;

export type WorkflowFailure = { code: string; fatal: boolean };

export function classifyWorkflowFailure(text: string): WorkflowFailure {
	const value = text.toLowerCase();
	if (
		value.includes("is not configured")
		|| value.includes("does not match")
		|| value.includes("deployment is incomplete")
		|| value.includes("does not have an active cctp origin chain")
		|| value.includes("nonce was consumed without a receipt")
		|| value.includes("0xa0d19b5e") // BurnsDisabled()
		|| value.includes("0x4bc75884") // InvalidCCTPMessage()
		|| value.includes("0x23455ba1") // InvalidWallet()
		|| value.includes("0x4a9b7eb0") // UnexpectedMintAmount()
		|| value.includes("0x3d36cb8d") // InvalidLabel()
		|| value.includes("0xdae95a07") // InvalidOracleConfig()
	) return { code: "invalid_configuration", fatal: true };
	if (value.includes("0xd4c19736")) return { code: "wallet_balance_changed", fatal: false }; // NoUSDC()
	if (value.includes("0x87a22607")) return { code: "amount_below_policy", fatal: false }; // BelowMinimumBurn()
	if (value.includes("0x15bd493b")) return { code: "name_not_renewable", fatal: false }; // NameNotRenewable()
	if (value.includes("0xd5139101")) return { code: "claim_already_used_or_failed", fatal: false }; // CCTPReceiveFailed()
	if (
		value.includes("429")
		|| value.includes("rate limit")
		|| value.includes("timeout")
		|| value.includes("network")
		|| value.includes("fetch failed")
		|| value.includes("rpc")
	) return { code: "rpc_unavailable", fatal: false };
	return { code: "workflow_step_failed", fatal: false };
}

function safeDetail(text: string): string {
	return text.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 500);
}

/** Persist a failed run so recovery and the UI do not mistake it for a pending chain action. */
export async function recordWorkflowFailure(flowId: string, text: string): Promise<void> {
	const failure = classifyWorkflowFailure(text);
	await database().transaction(async (tx) => {
		const [flow] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, flowId));
		if (!flow || ["settled", "cancelled", "failed"].includes(flow.status)) return;
		const now = new Date();
		const patch = failure.fatal
			? {
				status: "failed" as const,
				failedAt: now,
				nextActionAt: null,
			}
			: { nextActionAt: new Date(now.getTime() + RETRY_DELAY_MS) };
		const [updated] = await tx.update(flows).set({
			...patch,
			lastErrorCode: failure.code,
			lastErrorDetail: safeDetail(text),
			workflowRunId: null,
			updatedAt: now,
		}).where(and(
			eq(flows.id, flowId),
			notInArray(flows.status, ["settled", "cancelled", "failed"]),
		)).returning({ id: flows.id });
		if (updated && failure.fatal) {
			await tx.insert(flowTransitions).values({
				flowId,
				fromStatus: flow.status,
				toStatus: "failed",
				actor: "workflow",
				reasonCode: failure.code,
			});
		}
	});
}
