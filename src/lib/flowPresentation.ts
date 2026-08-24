import { HUB_CHAIN } from "./chains";
import type { FlowStatus as ApiFlowStatus } from "./publicApi";

export const ACTIVE_FLOW_STATUSES = [
	"queued",
	"confirming_deposit",
	"checking_name",
	"submitting_origin",
	"waiting_origin",
	"waiting_attestation",
	"submitting_claim",
	"waiting_claim",
] as const satisfies readonly ApiFlowStatus[];

export type ActiveFlowStatus = (typeof ACTIVE_FLOW_STATUSES)[number];

const activeStatuses = new Set<ApiFlowStatus>(ACTIVE_FLOW_STATUSES);

export function isActiveFlowStatus(status: ApiFlowStatus): status is ActiveFlowStatus {
	return activeStatuses.has(status);
}

export interface FlowPresentation {
	/** One compact word for the global activity table. */
	feed: string;
	/** One exact sentence fragment for the selected-name pending card. */
	detail: string;
}

export interface FlowFailurePresentation {
	label: string;
	detail: string;
}

/** Describe a reverted origin transaction without calling an Ethereum renewal a transfer. */
export function flowFailurePresentation(originChainId: string, errorCode?: string | null): FlowFailurePresentation {
	if (errorCode === "empty_wallet") {
		return {
			label: "Automatic processing stopped",
			detail: "Automatic processing stopped before it sent a transaction. The USDC is still at this address. Anyone can retry it.",
		};
	}
	if (originChainId === String(HUB_CHAIN.chainId)) {
		return {
			label: "Renewal did not go through",
			detail: "The renewal transaction did not go through. The USDC is still at this address. Anyone can retry it.",
		};
	}
	return {
		label: "Transfer did not go through",
		detail: "The Circle transfer did not go through. The USDC is still at this address. Anyone can retry it.",
	};
}

/** Keep backend workflow states exact and change only their user-facing description. */
export function flowPresentation(status: ActiveFlowStatus, originChainId: string): FlowPresentation {
	const ethereumOrigin = originChainId === String(HUB_CHAIN.chainId);
	switch (status) {
		case "queued":
			return { feed: "Queued", detail: "Queued to start" };
		case "confirming_deposit":
			return { feed: "Confirming", detail: "Confirming the deposit" };
		case "checking_name":
			return { feed: "Checking", detail: "Checking name eligibility" };
		case "submitting_origin":
			return ethereumOrigin
				? { feed: "Renewing", detail: "Submitting renewal on Ethereum" }
				: { feed: "Transferring", detail: "Starting the Circle transfer" };
		case "waiting_origin":
			return ethereumOrigin
				? { feed: "Renewing", detail: "Renewal submitted on Ethereum" }
				: { feed: "Transferring", detail: "Circle transfer submitted" };
		case "waiting_attestation":
			return { feed: "Attesting", detail: "Waiting for Circle attestation" };
		case "submitting_claim":
			return { feed: "Renewing", detail: "Submitting renewal on Ethereum" };
		case "waiting_claim":
			return { feed: "Renewing", detail: "Renewal submitted on Ethereum" };
	}
}
