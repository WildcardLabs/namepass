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

/** A durable workflow owns one Ethereum-origin flow. Network work stays in steps. */
export async function ethereumRenewal(flowId: string): Promise<"settled" | "held" | "cancelled"> {
	"use workflow";
	const flow = await loadEthereumFlowStep(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "settled" || flow.status === "held" || flow.status === "cancelled") return flow.status;

	while ((await confirmEthereumDepositStep(flowId)) === "waiting") await sleep("30s");
	const eligibility = await checkEthereumEligibilityStep(flowId);
	if (eligibility !== "ready") return eligibility;
	await simulateEthereumRenewalStep(flowId);
	const intentId = await prepareEthereumRenewalStep(flowId);
	await broadcastEthereumRenewalStep(intentId);
	for (;;) {
		const result = await confirmEthereumRenewalStep(flowId, intentId);
		if (result !== "waiting") return result;
		await sleep("5s");
	}
}
