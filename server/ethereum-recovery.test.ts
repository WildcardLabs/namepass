import assert from "node:assert/strict";
import test from "node:test";

import { ethereumResumeStage } from "../workflows/ethereum";

test("a stored Ethereum transaction resumes at its receipt", () => {
	assert.equal(ethereumResumeStage({
		status: "cancelled",
		originIntentId: "origin",
		originIntentStatus: "broadcast",
	}), "receipt");
});

test("a reverted Ethereum intent gets one new signed attempt after manual resume", () => {
	assert.equal(ethereumResumeStage({
		status: "queued",
		originIntentId: "origin",
		originIntentStatus: "reverted",
	}), "origin_retry");
});
