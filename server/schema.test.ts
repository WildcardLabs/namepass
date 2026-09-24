import assert from "node:assert/strict";
import test from "node:test";

import { serializeJsonb } from "./db/schema";

test("serializeJsonb writes BigInt fields as decimal strings (the receipt case)", () => {
	// Shape mirrors a viem transaction receipt: BigInts at top level and nested.
	const receipt = {
		status: "success",
		blockNumber: 8_675_309n,
		gasUsed: 21_000n,
		effectiveGasPrice: 1_000_000_000n,
		logs: [{ logIndex: 0, blockNumber: 8_675_309n, data: "0x" }],
	};
	const parsed = JSON.parse(serializeJsonb(receipt));
	assert.equal(parsed.blockNumber, "8675309");
	assert.equal(parsed.gasUsed, "21000");
	assert.equal(parsed.effectiveGasPrice, "1000000000");
	assert.equal(parsed.logs[0].blockNumber, "8675309");
	assert.equal(parsed.status, "success");
});
