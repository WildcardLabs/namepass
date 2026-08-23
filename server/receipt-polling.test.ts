import assert from "node:assert/strict";
import test from "node:test";

import { receiptPollDelay } from "../workflows/receipt-polling";

test("receipt polling slows down without stopping", () => {
	assert.equal(receiptPollDelay(0), "5s");
	assert.equal(receiptPollDelay(23), "5s");
	assert.equal(receiptPollDelay(24), "15s");
	assert.equal(receiptPollDelay(55), "15s");
	assert.equal(receiptPollDelay(56), "30s");
	assert.equal(receiptPollDelay(10_000), "30s");
});
