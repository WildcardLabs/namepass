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
}): "done" | "origin" | "attestation" | "claim" {
	if (["settled", "held", "cancelled"].includes(flow.status)) return "done";
	if (!flow.cctpMessage) return "origin";
	if (!flow.cctpAttestation) return "attestation";
	return "claim";
}

/** A durable workflow owns one L2 flow and one Circle message. */
export async function cctpRenewal(
	flowId: string,
): Promise<"settled" | "held" | "unclaimed" | "cancelled"> {
	"use workflow";
	let flow = await loadCctpFlowStep(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (cctpResumeStage(flow) === "done") {
		return flow.status as "settled" | "held" | "cancelled";
	}

	// A stored Circle message proves that the origin burn already happened.
	if (cctpResumeStage(flow) === "origin") {
		while ((await confirmCctpDepositStep(flowId)) === "waiting") await sleep("30s");
		const eligibility = await checkCctpEligibilityStep(flowId);
		if (eligibility !== "ready") return eligibility;
		await simulateCctpOriginStep(flowId);
		const originIntentId = await prepareCctpOriginStep(flowId);
		await broadcastCctpTransactionStep(originIntentId);
		for (;;) {
			const result = await confirmCctpOriginStep(flowId, originIntentId);
			if (result === "held") return "held";
			if (result === "attestation") break;
			await sleep("5s");
		}
		flow = (await loadCctpFlowStep(flowId))!;
	}

	if (cctpResumeStage(flow) === "attestation") {
		for (let attempt = 0; ; attempt += 1) {
			const iris = await pollCctpAttestationStep(flowId, attempt);
			if (iris.kind === "complete") break;
			await sleep(iris.retryAfterMs);
		}
	}

	if ((await simulateCctpClaimStep(flowId)) === "unclaimed") return "unclaimed";
	const claimIntentId = await prepareCctpClaimStep(flowId);
	await broadcastCctpTransactionStep(claimIntentId);
	for (;;) {
		const result = await confirmCctpClaimStep(flowId, claimIntentId);
		if (result !== "waiting") return result;
		await sleep("5s");
	}
}
