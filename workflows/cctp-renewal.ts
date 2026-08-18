import { sleep } from "workflow";

import {
	broadcastCctpTransactionStep,
	checkCctpEligibilityStep,
	confirmCctpClaimStep,
	confirmCctpDepositStep,
	confirmCctpOriginStep,
	loadCctpFlowStep,
	pollCctpAttestationStep,
	prepareCctpClaimStep,
	prepareCctpOriginStep,
	simulateCctpClaimStep,
	simulateCctpOriginStep,
} from "./cctp-steps";

export function cctpResumeStage(flow: {
	status: string;
	cctpMessage: string | null;
	cctpAttestation: string | null;
	originIntentId?: string | null;
	originIntentStatus?: string | null;
	claimIntentId?: string | null;
	claimIntentStatus?: string | null;
}): "done" | "origin" | "origin_retry" | "origin_receipt" | "attestation" | "claim" | "claim_receipt" {
	if (["settled", "held", "failed"].includes(flow.status)) return "done";
	if (flow.claimIntentId) {
		return flow.claimIntentStatus === "reverted" ? "claim" : "claim_receipt";
	}
	if (flow.cctpMessage && flow.cctpAttestation) return "claim";
	if (flow.cctpMessage) return "attestation";
	if (flow.originIntentId) {
		return flow.originIntentStatus === "reverted" ? "origin_retry" : "origin_receipt";
	}
	if (flow.status === "cancelled") return "done";
	return "origin";
}

export function cctpDepositAction(
	result: "ready" | "waiting" | "cancelled",
): "proceed" | "wait" | "cancelled" {
	if (result === "waiting") return "wait";
	return result === "cancelled" ? "cancelled" : "proceed";
}

export function cctpClaimAction(
	result: "ready" | "unclaimed" | "settled",
): "proceed" | "unclaimed" | "settled" {
	return result === "ready" ? "proceed" : result;
}

/** A durable workflow owns one L2 flow and one Circle message. */
export async function cctpRenewal(
	flowId: string,
): Promise<"settled" | "held" | "unclaimed" | "cancelled" | "failed"> {
	"use workflow";
	let flow = await loadCctpFlowStep(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	let resume = cctpResumeStage(flow);
	if (resume === "done") {
		return flow.status as "settled" | "held" | "cancelled" | "failed";
	}

	// A stored Circle message proves that the origin burn already happened.
	if (resume === "origin" || resume === "origin_retry" || resume === "origin_receipt") {
		if (resume === "origin") {
			let deposit = cctpDepositAction(await confirmCctpDepositStep(flowId));
			while (deposit === "wait") {
				await sleep("30s");
				deposit = cctpDepositAction(await confirmCctpDepositStep(flowId));
			}
			if (deposit === "cancelled") return "cancelled";
			const eligibility = await checkCctpEligibilityStep(flowId);
			if (eligibility !== "ready") return eligibility;
		}
		let originIntentId = flow.originIntentId;
		if (resume !== "origin_receipt") {
			await simulateCctpOriginStep(flowId);
			originIntentId = await prepareCctpOriginStep(flowId);
		}
		if (!originIntentId) throw new Error("The CCTP flow has no origin transaction intent.");
		await broadcastCctpTransactionStep(originIntentId);
		for (;;) {
			const result = await confirmCctpOriginStep(flowId, originIntentId);
			if (result === "held") return "held";
			if (result === "attestation") break;
			await sleep("5s");
		}
		flow = (await loadCctpFlowStep(flowId))!;
		resume = cctpResumeStage(flow);
	}

	if (resume === "attestation") {
		for (let attempt = 0; ; attempt += 1) {
			const iris = await pollCctpAttestationStep(flowId, attempt);
			if (iris.kind === "complete") break;
			await sleep(iris.retryAfterMs);
		}
		flow = (await loadCctpFlowStep(flowId))!;
		resume = cctpResumeStage(flow);
	}

	if (resume === "done") {
		return flow.status as "settled" | "held" | "cancelled" | "failed";
	}
	let claimIntentId = flow.claimIntentId;
	if (resume !== "claim_receipt") {
		const claim = cctpClaimAction(await simulateCctpClaimStep(flowId));
		if (claim === "unclaimed" || claim === "settled") return claim;
		claimIntentId = await prepareCctpClaimStep(flowId);
	}
	if (!claimIntentId) throw new Error("The CCTP flow has no claim transaction intent.");
	await broadcastCctpTransactionStep(claimIntentId);
	for (;;) {
		const result = await confirmCctpClaimStep(flowId, claimIntentId);
		if (result !== "waiting") return result;
		await sleep("5s");
	}
}
