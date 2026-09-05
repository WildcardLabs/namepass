import assert from "node:assert/strict";
import test from "node:test";

import { ethereumResumeStage } from "../workflows/ethereum";

test("a cancelled Ethereum flow never resumes a stored transaction", () => {
	assert.equal(ethereumResumeStage({
		status: "cancelled",
		originIntentId: "origin",
		originIntentStatus: "broadcast",
	}), "done");
});

test("a reverted Ethereum intent gets one new signed attempt after manual resume", () => {
	assert.equal(ethereumResumeStage({
		status: "queued",
		originIntentId: "origin",
		originIntentStatus: "reverted",
	}), "origin_retry");
});
