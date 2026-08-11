import assert from "node:assert/strict";
import test from "node:test";

import { claimIntentAction, matchesRecordedCctpDepositTransfer } from "./cctp-renewal";
import { transactionIntentAction } from "./transactions";
import { cctpResumeStage } from "../workflows/cctp-renewal";
import type { Address } from "viem";

test("an unclaimed flow resumes the same claim and never returns to the burn", () => {
	assert.equal(
		cctpResumeStage({
			status: "unclaimed",
			cctpMessage: "0x1234",
			cctpAttestation: "0xabcd",
		}),
		"claim",
	);
	assert.equal(claimIntentAction("reverted"), "retry");
});

test("duplicate execution stops after settlement", () => {
	assert.equal(
		cctpResumeStage({ status: "settled", cctpMessage: "0x1234", cctpAttestation: "0xabcd" }),
		"done",
	);
});

test("CCTP event-backed flows require the recorded transfer amount", () => {
	const wallet = "0x1111111111111111111111111111111111111111" as Address;
	assert.equal(matchesRecordedCctpDepositTransfer({ to: wallet, value: 1_000_000n }, wallet, "1000000"), true);
	assert.equal(matchesRecordedCctpDepositTransfer({ to: wallet, value: 999_999n }, wallet, "1000000"), false);
});

test("a reverted CCTP origin retries its logical intent without returning to a burn", () => {
	assert.equal(transactionIntentAction("reverted"), "retry");
	assert.equal(cctpResumeStage({ status: "held", cctpMessage: null, cctpAttestation: null }), "done");
});
