import { sleep } from "workflow";

import {
	broadcastEthereumRenewalStep,
	checkEthereumEligibilityStep,
	confirmEthereumDepositStep,
	confirmEthereumRenewalStep,
	loadEthereumFlowStep,
	prepareEthereumRenewalStep,
	simulateEthereumRenewalStep,
} from "./ethereum-steps";

export function ethereumResumeStage(flow: {
	status: string;
	originIntentId: string | null;
	originIntentStatus: string | null;
}): "done" | "origin" | "origin_retry" | "receipt" {
	if (["settled", "held", "failed"].includes(flow.status)) return "done";
	if (flow.originIntentId) {
		return flow.originIntentStatus === "reverted" ? "origin_retry" : "receipt";
	}
	if (flow.status === "cancelled") return "done";
	return "origin";
}

/** A durable workflow owns one Ethereum-origin flow. Network work stays in steps. */
export async function ethereumRenewal(
	flowId: string,
): Promise<"settled" | "held" | "cancelled" | "failed"> {
	"use workflow";
	const flow = await loadEthereumFlowStep(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	const resume = ethereumResumeStage(flow);
	if (resume === "done") return flow.status as "settled" | "held" | "cancelled" | "failed";

	if (resume === "origin") {
		if ((await confirmEthereumDepositStep(flowId)) === "cancelled") return "cancelled";
		const eligibility = await checkEthereumEligibilityStep(flowId);
		if (eligibility !== "ready") return eligibility;
	}
	let intentId = flow.originIntentId;
	if (resume !== "receipt") {
		await simulateEthereumRenewalStep(flowId);
		intentId = await prepareEthereumRenewalStep(flowId);
	}
	if (!intentId) throw new Error("The Ethereum flow has no transaction intent.");
	await broadcastEthereumRenewalStep(intentId);
	for (;;) {
		const result = await confirmEthereumRenewalStep(flowId, intentId);
		if (result !== "waiting") return result;
		await sleep("5s");
	}
}
