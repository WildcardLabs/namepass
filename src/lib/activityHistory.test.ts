import { expect, test } from "vitest";

import { mergeActivityHistory, mergeNameHistory } from "./activityHistory";
import type { PublicName, PublicRenewal } from "./publicApi";

function renewal(eventId: string, blockTime: string, amountReceived = "1000000"): PublicRenewal {
	return {
		eventId,
		flowId: `flow:${eventId}`,
		originChainId: "84532",
		funderAddress: null,
		executorAddress: "0x0000000000000000000000000000000000000001",
		executorIsRelayer: true,
		amountReceived,
		gasAllowance: "100000",
		amountApplied: "900000",
		durationSeconds: "100",
		expiryAfter: null,
		fromCctp: true,
		depositTxHash: null,
		originTxHash: null,
		claimTxHash: null,
		renewalTxHash: `0x${eventId.padEnd(64, "0")}`,
		blockTime,
	};
}

const name: PublicName = {
	label: "history-test",
	displayName: "history-test.eth",
	depositAddress: "0x0000000000000000000000000000000000000002",
	activatedAt: "2026-08-10T00:00:00.000Z",
	currentExpiry: null,
	renewableBy: "registrar",
	ensSyncedAt: "2026-08-10T00:00:00.000Z",
	unscannedChainIds: [],
	lifetimeReceived: "0",
	lifetimeApplied: "0",
	timeDeliveredSeconds: "0",
	renewalCount: "0",
};

test("name history merges refreshes and older pages without duplicates", () => {
	const current = [
		renewal("newest", "2026-08-12T00:00:00.000Z"),
		renewal("shared", "2026-08-11T00:00:00.000Z"),
	];
	const refreshed = mergeNameHistory(current, [
		renewal("shared", "2026-08-11T00:00:00.000Z", "2000000"),
	]);
	const withOlderPage = mergeNameHistory(refreshed, [
		renewal("oldest", "2026-08-10T00:00:00.000Z"),
	]);

	expect(withOlderPage.map((item) => item.eventId)).toEqual(["newest", "shared", "oldest"]);
	expect(withOlderPage.find((item) => item.eventId === "shared")?.amountReceived).toBe("2000000");
});

test("global activity uses renewal IDs and block times for replacement and ordering", () => {
	const older = { name, renewal: renewal("older", "2026-08-10T00:00:00.000Z") };
	const current = [
		older,
		{ name, renewal: renewal("shared", "2026-08-11T00:00:00.000Z") },
	];
	const merged = mergeActivityHistory(current, [
		{ name: { ...name, displayName: "updated.eth" }, renewal: renewal("shared", "2026-08-11T00:00:00.000Z") },
		{ name, renewal: renewal("newest", "2026-08-12T00:00:00.000Z") },
	]);

	expect(merged.map((item) => item.renewal.eventId)).toEqual(["newest", "shared", "older"]);
	expect(merged.find((item) => item.renewal.eventId === "shared")?.name.displayName).toBe("updated.eth");
});
