import assert from "node:assert/strict";
import test from "node:test";

import {
	cctpOriginTransactionHash,
	claimIntentAction,
	matchesRecordedArcNativeDeposit,
	matchesRecordedCctpDepositTransfer,
} from "./cctp-renewal";
import { transactionIntentAction } from "./transactions";
import { cctpClaimAction, cctpDepositAction, cctpResumeStage } from "../workflows/cctp-renewal";
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
	assert.equal(cctpClaimAction("settled"), "settled");
	assert.equal(cctpClaimAction("ready"), "proceed");
});

test("a cancelled deposit stops before CCTP eligibility and burn", () => {
	assert.equal(cctpDepositAction("ready"), "proceed");
	assert.equal(cctpDepositAction("cancelled"), "cancelled");
});

test("CCTP event-backed flows require the recorded transfer amount", () => {
	const wallet = "0x1111111111111111111111111111111111111111" as Address;
	assert.equal(matchesRecordedCctpDepositTransfer({ to: wallet, value: 1_000_000n }, wallet, "1000000"), true);
	assert.equal(matchesRecordedCctpDepositTransfer({ to: wallet, value: 999_999n }, wallet, "1000000"), false);
});

test("Arc native deposits convert 18-decimal transaction value to 6-decimal USDC", () => {
	const wallet = "0x1111111111111111111111111111111111111111" as Address;
	assert.equal(matchesRecordedArcNativeDeposit(
		{ to: wallet, value: 15_000_000_000_000_000_000n },
		wallet,
		"15000000",
	), true);
	assert.equal(matchesRecordedArcNativeDeposit(
		{ to: wallet, value: 15_000_000_000_000_000_001n },
		wallet,
		"15000000",
	), false);
	assert.equal(matchesRecordedArcNativeDeposit(
		{ to: "0x2222222222222222222222222222222222222222", value: 15_000_000_000_000_000_000n },
		wallet,
		"15000000",
	), false);
});

test("a reverted CCTP origin retries its logical intent without returning to a burn", () => {
	assert.equal(transactionIntentAction("reverted"), "retry");
	assert.equal(cctpResumeStage({ status: "held", cctpMessage: null, cctpAttestation: null }), "done");
});

test("a cancelled CCTP flow never resumes a stored transaction", () => {
	assert.equal(cctpResumeStage({
		status: "cancelled",
		cctpMessage: null,
		cctpAttestation: null,
		originIntentId: "origin",
		originIntentStatus: "broadcast",
	}), "done");
	assert.equal(cctpResumeStage({
		status: "waiting_claim",
		cctpMessage: "0x1234",
		cctpAttestation: "0xabcd",
		claimIntentId: "claim",
		claimIntentStatus: "broadcast",
	}), "claim_receipt");
});

test("a permissionless origin burn resumes from its indexed transaction", () => {
	assert.equal(cctpResumeStage({
		status: "waiting_origin",
		cctpMessage: null,
		cctpAttestation: null,
		originEvidenceTxHash: `0x${"1".repeat(64)}`,
	}), "origin_receipt");
});

test("Iris uses the mined origin attempt instead of a later replacement hash", () => {
	const mined = `0x${"2".repeat(64)}` as const;
	const replacement = `0x${"3".repeat(64)}`;
	assert.equal(cctpOriginTransactionHash(mined, replacement), mined);
	assert.equal(cctpOriginTransactionHash(null, replacement), replacement);
});
