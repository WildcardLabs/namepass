import { chainById, HUB_CHAIN } from "./chains";
import { safeInteger, type FlowStatus, type PublicFlow } from "./publicApi";

export interface CompletedFlowTransaction {
	label: "Payment received" | "Circle burn confirmed";
	chain: string;
	tx: string;
}

const BURN_CONFIRMED_STATUSES = new Set<FlowStatus>([
	"waiting_attestation",
	"submitting_claim",
	"waiting_claim",
	"unclaimed",
	"settled",
]);

/** Return only transactions whose successful receipts are already part of the flow state. */
export function completedFlowTransactions(
	flow: Pick<PublicFlow, "originChainId" | "status" | "evidence">,
): CompletedFlowTransaction[] {
	const chain = chainById(safeInteger(flow.originChainId) ?? -1);
	if (!chain || !flow.evidence) return [];
	const transactions: CompletedFlowTransaction[] = [];
	if (flow.evidence.depositTxHash) {
		transactions.push({ label: "Payment received", chain: chain.name, tx: flow.evidence.depositTxHash });
	}
	if (
		chain.chainId !== HUB_CHAIN.chainId
		&& flow.evidence.originTxHash
		&& BURN_CONFIRMED_STATUSES.has(flow.status)
	) {
		transactions.push({ label: "Circle burn confirmed", chain: chain.name, tx: flow.evidence.originTxHash });
	}
	return transactions;
}
