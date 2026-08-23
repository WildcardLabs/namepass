import assert from "node:assert/strict";
import test from "node:test";

import type { flows } from "./db/schema";
import { visibleNameFlows, type NameFlowRow } from "./names";

function row(status: "queued" | "cancelled", reasonCode: string | null): NameFlowRow {
	return {
		flow: {
			id: status,
			originChainId: "84532",
			status,
			lastErrorCode: null,
		} as typeof flows.$inferSelect,
		depositTxHash: status === "cancelled" ? `0x${"1".repeat(64)}` : null,
		originTxHash: null,
		claimTxHash: null,
		reasonCode,
	};
}

test("the name API keeps one actionable stopped flow while eligible funds remain", () => {
	const [stopped] = visibleNameFlows(
		[row("cancelled", "empty_wallet")],
		[{ chainId: "84532", amount: "20000000" }],
	);
	assert.equal(stopped?.flow.status, "cancelled");
	assert.equal(stopped?.flow.lastErrorCode, "empty_wallet");
	assert.equal(stopped?.depositTxHash, `0x${"1".repeat(64)}`);
	assert.equal(visibleNameFlows(
		[row("cancelled", "empty_wallet")],
		[{ chainId: "84532", amount: "0" }],
	).length, 0);
});

test("an active flow hides an older stopped flow on the same chain", () => {
	const visible = visibleNameFlows(
		[row("queued", null), row("cancelled", "empty_wallet")],
		[{ chainId: "84532", amount: "20000000" }],
	);
	assert.deepEqual(visible.map((item) => item.flow.status), ["queued"]);
});
