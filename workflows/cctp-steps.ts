export async function loadCctpFlowStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).loadCctpFlow(flowId);
}

export async function confirmCctpDepositStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).confirmCctpDeposit(flowId);
}

export async function checkCctpEligibilityStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).checkCctpEligibility(flowId);
}

export async function simulateCctpOriginStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).simulateCctpOrigin(flowId);
}

export async function prepareCctpOriginStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).prepareCctpOrigin(flowId);
}

export async function broadcastCctpTransactionStep(intentId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).broadcastCctpTransaction(intentId);
}

export async function confirmCctpOriginStep(flowId: string, intentId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).confirmCctpOrigin(flowId, intentId);
}

export async function pollCctpAttestationStep(flowId: string, attempt: number) {
	"use step";
	return (await import("../server/cctp-renewal")).pollCctpAttestation(flowId, attempt);
}

export async function simulateCctpClaimStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).simulateCctpClaim(flowId);
}

export async function prepareCctpClaimStep(flowId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).prepareCctpClaim(flowId);
}

export async function confirmCctpClaimStep(flowId: string, intentId: string) {
	"use step";
	return (await import("../server/cctp-renewal")).confirmCctpClaim(flowId, intentId);
}
