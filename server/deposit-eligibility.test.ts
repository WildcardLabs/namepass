import assert from "node:assert/strict";
import test from "node:test";

import { depositBalanceAction } from "./deposit-eligibility";

test("a zero replica read at a verified deposit block retries instead of cancelling", () => {
	assert.equal(depositBalanceAction(0n, 12_345n), "retry");
	assert.equal(depositBalanceAction(20_000_000n, 12_345n), "ready");
});

test("an unlinked balance recovery can still stop when the live wallet is empty", () => {
	assert.equal(depositBalanceAction(0n, undefined), "cancelled");
});
