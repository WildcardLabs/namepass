import { describe, expect, test } from "vitest";

import type { PublicFlow } from "./publicApi";
import { completedFlowTransactions } from "./flowTransactions";

const depositTxHash = `0x${"1".repeat(64)}`;
const originTxHash = `0x${"2".repeat(64)}`;
type TransactionFlow = Pick<PublicFlow, "originChainId" | "status" | "evidence">;

function flow(overrides: Partial<TransactionFlow> = {}): TransactionFlow {
	return {
		originChainId: "84532",
		status: "waiting_attestation",
		evidence: {
			depositTxHash,
			originTxHash,
			claimTxHash: null,
			renewalTxHash: null,
			executorAddress: null,
			executorIsRelayer: false,
		},
		...overrides,
	};
}

describe("completed flow transactions", () => {
	test("shows the confirmed deposit and CCTP burn while waiting for attestation", () => {
		expect(completedFlowTransactions(flow())).toEqual([
			{ label: "Payment received", chain: "Base", tx: depositTxHash },
			{ label: "Circle burn confirmed", chain: "Base", tx: originTxHash },
		]);
	});

	test("does not call a submitted burn complete before its receipt", () => {
		expect(completedFlowTransactions(flow({ status: "waiting_origin" }))).toEqual([
			{ label: "Payment received", chain: "Base", tx: depositTxHash },
		]);
	});
});
