export async function loadEthereumFlowStep(flowId: string) {
	"use step";
	return (await import("../server/ethereum")).loadEthereumFlow(flowId);
}

export async function confirmEthereumDepositStep(flowId: string) {
	"use step";
	return (await import("../server/ethereum")).confirmEthereumDeposit(flowId);
}

export async function checkEthereumEligibilityStep(flowId: string) {
	"use step";
	return (await import("../server/ethereum")).checkEthereumEligibility(flowId);
}

export async function simulateEthereumRenewalStep(flowId: string) {
	"use step";
	return (await import("../server/ethereum")).simulateEthereumRenewal(flowId);
}

export async function prepareEthereumRenewalStep(flowId: string) {
	"use step";
	return (await import("../server/ethereum")).prepareEthereumRenewal(flowId);
}

export async function broadcastEthereumRenewalStep(intentId: string) {
	"use step";
	return (await import("../server/ethereum")).broadcastEthereumRenewal(intentId);
}

export async function confirmEthereumRenewalStep(flowId: string, intentId: string) {
	"use step";
	return (await import("../server/ethereum")).confirmEthereumRenewal(flowId, intentId);
}
