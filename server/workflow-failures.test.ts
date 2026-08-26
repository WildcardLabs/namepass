import assert from "node:assert/strict";
import test from "node:test";

import { classifyWorkflowFailure } from "./workflow-failures";

test("workflow errors separate retryable chain state from invalid configuration", () => {
	assert.deepEqual(classifyWorkflowFailure("execution reverted: 0xd4c19736"), {
		code: "wallet_balance_changed",
		fatal: false,
	});
	assert.deepEqual(classifyWorkflowFailure("execution reverted: 0xa0d19b5e"), {
		code: "invalid_configuration",
		fatal: true,
	});
	assert.deepEqual(classifyWorkflowFailure("RPC request rate limited with 429"), {
		code: "rpc_unavailable",
		fatal: false,
	});
});
