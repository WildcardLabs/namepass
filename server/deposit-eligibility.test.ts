import assert from "node:assert/strict";
import test from "node:test";

import { depositBalanceAction, depositWasAbsorbed, liveDepositBalanceAction } from "./deposit-eligibility";

test("a zero replica read at a verified deposit block retries instead of cancelling", () => {
	assert.equal(depositBalanceAction(0n, 12_345n), "retry");
	assert.equal(depositBalanceAction(20_000_000n, 12_345n), "ready");
});

test("an unlinked balance recovery can still stop when the live wallet is empty", () => {
	assert.equal(depositBalanceAction(0n, undefined), "cancelled");
});

test("a deposit that a later origin transaction consumed is cancelled before signing", () => {
	assert.equal(liveDepositBalanceAction({
		verifiedBalance: 9_000_000n,
		verifiedBlock: 46_507_024n,
		liveBalance: 0n,
		liveBlock: 46_507_026n,
	}), "absorbed");
	assert.equal(liveDepositBalanceAction({
		verifiedBalance: 0n,
		verifiedBlock: 46_507_024n,
		liveBalance: 0n,
		liveBlock: 46_507_025n,
	}), "absorbed");
	assert.equal(depositWasAbsorbed({
		depositBlock: 46_507_024n,
		originBlock: 46_507_026n,
		remainingAmount: 0n,
	}), true);
});

test("a current balance and a same-block replica gap do not look absorbed", () => {
	assert.equal(liveDepositBalanceAction({
		verifiedBalance: 9_000_000n,
		verifiedBlock: 100n,
		liveBalance: 9_000_000n,
		liveBlock: 102n,
	}), "ready");
	assert.equal(liveDepositBalanceAction({
		verifiedBalance: 9_000_000n,
		verifiedBlock: 100n,
		liveBalance: 0n,
		liveBlock: 100n,
	}), "retry");
	assert.equal(depositWasAbsorbed({
		depositBlock: 100n,
		originBlock: 100n,
		remainingAmount: 0n,
	}), false);
	assert.equal(depositWasAbsorbed({
		depositBlock: 100n,
		originBlock: 102n,
		remainingAmount: 1n,
	}), false);
});
