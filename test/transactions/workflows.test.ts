import { beforeEach, expect, test, vi } from "vitest";

vi.mock("workflow", () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../workflows/ethereum-steps", () => ({
	loadEthereumFlowStep: vi.fn(), confirmEthereumDepositStep: vi.fn(),
	checkEthereumEligibilityStep: vi.fn(), prepareEthereumRenewalStep: vi.fn(),
	broadcastEthereumRenewalStep: vi.fn(), confirmEthereumRenewalStep: vi.fn(),
}));
vi.mock("../../workflows/cctp-steps", () => ({
	loadCctpFlowStep: vi.fn(), confirmCctpDepositStep: vi.fn(), checkCctpEligibilityStep: vi.fn(),
	prepareCctpOriginStep: vi.fn(), broadcastCctpTransactionStep: vi.fn(),
	confirmCctpOriginStep: vi.fn(), pollCctpAttestationStep: vi.fn(), simulateCctpClaimStep: vi.fn(),
	prepareCctpClaimStep: vi.fn(), confirmCctpClaimStep: vi.fn(),
}));
vi.mock("../../workflows/common-steps", () => ({ recordWorkflowFailureStep: vi.fn() }));

import { sleep } from "workflow";
import * as ethereum from "../../workflows/ethereum-steps";
import * as cctp from "../../workflows/cctp-steps";
import { recordWorkflowFailureStep } from "../../workflows/common-steps";
import { ethereumRenewal } from "../../workflows/ethereum";
import { cctpRenewal } from "../../workflows/cctp-renewal";

const eth = vi.mocked(ethereum);
const circle = vi.mocked(cctp);
const originFlow = {
	id: "flow", nameId: "name", label: "example", status: "checking_name" as const,
	trigger: "automatic" as const, depositAddress: `0x${"1".repeat(40)}` as const,
	depositEventId: null, depositTxHash: null, depositLogIndex: null,
	depositBlockNumber: null, eligibilityBlockNumber: null, depositCanonical: null,
	depositStatus: null, depositAmount: null,
	originIntentId: null, originIntentStatus: null,
};

type EthereumFlow = NonNullable<Awaited<ReturnType<typeof ethereum.loadEthereumFlowStep>>>;
type CctpFlow = NonNullable<Awaited<ReturnType<typeof cctp.loadCctpFlowStep>>>;

function ethFlow(patch: Partial<EthereumFlow> = {}): EthereumFlow {
	return { ...originFlow, ...patch };
}
function cctpFlow(patch: Partial<CctpFlow> = {}): CctpFlow {
	return {
		...originFlow, originChainId: 5042002, amountDetected: "1000000",
		amountProcessed: null, remainingAmount: null, originEventId: null,
		originEventTxHash: null, originEventLogIndex: null, originEventBlockNumber: null,
		originEventCanonical: null, originEvidenceTxHash: null,
		claimIntentId: null, claimIntentStatus: null, cctpNonce: null, cctpMessageIndex: null,
		cctpMessage: null, cctpAttestation: null, ...patch,
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	eth.loadEthereumFlowStep.mockResolvedValue(ethFlow());
	eth.confirmEthereumDepositStep.mockResolvedValue("ready");
	eth.checkEthereumEligibilityStep.mockResolvedValue("ready");
	eth.prepareEthereumRenewalStep.mockResolvedValue("origin-intent");
	eth.confirmEthereumRenewalStep.mockResolvedValue("settled");
	circle.loadCctpFlowStep.mockResolvedValue(cctpFlow({
		status: "waiting_attestation", cctpMessage: "0x12", cctpAttestation: "0x34",
		originIntentId: "origin-intent",
	}));
	circle.confirmCctpDepositStep.mockResolvedValue("ready");
	circle.checkCctpEligibilityStep.mockResolvedValue("ready");
	circle.prepareCctpOriginStep.mockResolvedValue("origin-intent");
	circle.confirmCctpOriginStep.mockResolvedValue("attestation");
	circle.simulateCctpClaimStep.mockResolvedValue("ready");
	circle.prepareCctpClaimStep.mockResolvedValue("claim-intent");
	circle.confirmCctpClaimStep.mockResolvedValue("settled");
	circle.pollCctpAttestationStep.mockResolvedValue({
		kind: "complete", message: "0x12", attestation: "0x34", status: "complete",
	});
});

test.each(["ethereum", "cctp_origin", "cctp_claim"] as const)(
	"%s keeps a long queue wait out of the receipt backoff",
	async (path) => {
		const poll = path === "ethereum" ? eth.confirmEthereumRenewalStep
			: path === "cctp_origin" ? circle.confirmCctpOriginStep : circle.confirmCctpClaimStep;
		for (let i = 0; i < 100; i++) poll.mockResolvedValueOnce("queued");
		for (let i = 0; i < 25; i++) poll.mockResolvedValueOnce("waiting");
		if (path === "cctp_origin") circle.loadCctpFlowStep.mockResolvedValueOnce(cctpFlow());
		await expect(path === "ethereum" ? ethereumRenewal("flow") : cctpRenewal("flow"))
			.resolves.toBe("settled");
		expect(vi.mocked(sleep).mock.calls.slice(0, 124).map(([delay]) => delay))
			.toEqual(Array(124).fill("5s"));
		expect(vi.mocked(sleep).mock.calls[124]).toEqual(["15s"]);
		expect(poll).toHaveBeenCalledTimes(126);
		expect(recordWorkflowFailureStep).not.toHaveBeenCalled();
		if (path === "ethereum") {
			expect(eth.prepareEthereumRenewalStep).toHaveBeenCalledOnce();
			expect(eth.confirmEthereumDepositStep).toHaveBeenCalledOnce();
		} else {
			expect(circle.prepareCctpClaimStep).toHaveBeenCalledOnce();
			expect(circle.prepareCctpOriginStep).toHaveBeenCalledTimes(path === "cctp_origin" ? 1 : 0);
		}
	},
);

test("a resumed prepared Ethereum intent waits without signing or rechecking the spent balance", async () => {
	eth.loadEthereumFlowStep.mockResolvedValue(ethFlow({
		status: "submitting_origin", originIntentId: "stored-origin", originIntentStatus: "prepared",
	}));
	eth.confirmEthereumRenewalStep.mockResolvedValueOnce("queued");
	await expect(ethereumRenewal("flow")).resolves.toBe("settled");
	expect(eth.broadcastEthereumRenewalStep).toHaveBeenCalledWith("stored-origin");
	expect(eth.prepareEthereumRenewalStep).not.toHaveBeenCalled();
	expect(eth.checkEthereumEligibilityStep).not.toHaveBeenCalled();
});

test("a resumed queued CCTP claim reuses its intent and never burns again", async () => {
	circle.loadCctpFlowStep.mockResolvedValue(cctpFlow({
		status: "submitting_claim", cctpMessage: "0x12", cctpAttestation: "0x34",
		claimIntentId: "stored-claim", claimIntentStatus: "prepared",
	}));
	circle.confirmCctpClaimStep.mockResolvedValueOnce("queued");
	await expect(cctpRenewal("flow")).resolves.toBe("settled");
	expect(circle.broadcastCctpTransactionStep).toHaveBeenCalledWith("stored-claim");
	expect(circle.prepareCctpClaimStep).not.toHaveBeenCalled();
	expect(circle.prepareCctpOriginStep).not.toHaveBeenCalled();
	expect(circle.pollCctpAttestationStep).not.toHaveBeenCalled();
});

test("an absorbed deposit stops both workflows before a signed origin exists", async () => {
	eth.prepareEthereumRenewalStep.mockResolvedValue(null);
	circle.loadCctpFlowStep.mockResolvedValueOnce(cctpFlow());
	circle.prepareCctpOriginStep.mockResolvedValue(null);
	await expect(ethereumRenewal("eth-flow")).resolves.toBe("cancelled");
	await expect(cctpRenewal("cctp-flow")).resolves.toBe("cancelled");
	expect(eth.broadcastEthereumRenewalStep).not.toHaveBeenCalled();
	expect(circle.broadcastCctpTransactionStep).not.toHaveBeenCalled();
	expect(circle.pollCctpAttestationStep).not.toHaveBeenCalled();
});

test.each(["settled", "cancelled", "failed", "held"] as const)("terminal %s flows do not reopen prepared intents", async (status) => {
	eth.loadEthereumFlowStep.mockResolvedValue(ethFlow({ status, originIntentId: "stored-origin", originIntentStatus: "prepared" }));
	circle.loadCctpFlowStep.mockResolvedValue(cctpFlow({ status, claimIntentId: "stored-claim", claimIntentStatus: "prepared" }));
	await expect(ethereumRenewal("eth-flow")).resolves.toBe(status);
	await expect(cctpRenewal("cctp-flow")).resolves.toBe(status);
	expect(eth.broadcastEthereumRenewalStep).not.toHaveBeenCalled();
	expect(circle.broadcastCctpTransactionStep).not.toHaveBeenCalled();
});

test("a permissionless origin continues receipt verification without signing a second burn", async () => {
	circle.loadCctpFlowStep.mockResolvedValueOnce(cctpFlow({
		status: "waiting_origin", originEvidenceTxHash: `0x${"1".repeat(64)}`,
	}));
	await expect(cctpRenewal("flow")).resolves.toBe("settled");
	expect(circle.confirmCctpOriginStep).toHaveBeenCalledWith("flow", null);
	expect(circle.prepareCctpOriginStep).not.toHaveBeenCalled();
	expect(circle.broadcastCctpTransactionStep).toHaveBeenCalledExactlyOnceWith("claim-intent");
});

test("a broadcast fault still records failure for recovery of the same flow", async () => {
	eth.broadcastEthereumRenewalStep.mockRejectedValue(new Error("RPC unavailable"));
	await expect(ethereumRenewal("flow")).rejects.toThrow("RPC unavailable");
	expect(recordWorkflowFailureStep).toHaveBeenCalledWith("flow", "Error: RPC unavailable");
	expect(eth.confirmEthereumRenewalStep).not.toHaveBeenCalled();
});
