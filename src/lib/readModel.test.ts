import { expect, test } from "vitest";

import { recentActivity, renewalEvent, syncFeed } from "./readModel";
import { setRates } from "./pricing";

test("the browser maps canonical renewal facts without inventing a sender", () => {
	setRates({
		oracle: "0x0000000000000000000000000000000000000001",
		denom: 100n,
		baseRates: [1n, 1n, 1n, 1n, 1n],
		points: [{ duration: 2n, numer: 50n }],
		tokenNumer: 1n,
		tokenDenom: 1n,
		readAt: 0,
	});
	const event = renewalEvent({
		eventId: "renewal-1",
		flowId: "flow-1",
		originChainId: "84532",
		funderAddress: null,
		executorAddress: "0x0000000000000000000000000000000000000002",
		executorIsRelayer: false,
		amountReceived: "100",
		gasAllowance: "10",
		amountApplied: "90",
		durationSeconds: "180",
		expiryAfter: "2026-08-12T00:00:00.000Z",
		fromCctp: true,
		depositTxHash: null,
		originTxHash: `0x${"1".repeat(64)}`,
		claimTxHash: `0x${"2".repeat(64)}`,
		renewalTxHash: `0x${"2".repeat(64)}`,
		blockTime: "2026-08-11T00:00:00.000Z",
	}, "vitalik");

	expect(event.kind).toBe("renewal");
	expect(event.funder).toBe("Sender unavailable");
	expect(event.executor).toBe("0x0000000000000000000000000000000000000002");
	expect(event.steps.map((step) => step.kind)).toEqual(["burn", "renewal"]);
});

test("the browser removes a recent renewal after a canonical delete", () => {
	setRates({
		oracle: "0x0000000000000000000000000000000000000001",
		denom: 100n,
		baseRates: [1n, 1n, 1n, 1n, 1n],
		points: [{ duration: 2n, numer: 50n }],
		tokenNumer: 1n,
		tokenDenom: 1n,
		readAt: 0,
	});
	const renewal = {
		eventId: "renewal-reorg",
		flowId: "flow-reorg",
		originChainId: "84532",
		funderAddress: null,
		executorAddress: "0x0000000000000000000000000000000000000002",
		executorIsRelayer: false,
		amountReceived: "100",
		gasAllowance: "10",
		amountApplied: "90",
		durationSeconds: "180",
		expiryAfter: null,
		fromCctp: false,
		depositTxHash: null,
		originTxHash: null,
		claimTxHash: null,
		renewalTxHash: `0x${"3".repeat(64)}`,
		blockTime: "2026-08-11T00:00:00.000Z",
	};
	const name = {
		label: "reorg-test",
		displayName: "reorg-test.eth",
		depositAddress: "0x0000000000000000000000000000000000000003",
		activatedAt: "2026-08-10T00:00:00.000Z",
		currentExpiry: null,
		renewableBy: null,
		ensSyncedAt: "2026-08-10T00:00:00.000Z",
		unscannedChainIds: [],
		lifetimeReceived: "100",
		lifetimeApplied: "90",
		timeDeliveredSeconds: "180",
		renewalCount: "1",
	};

	syncFeed({ items: [{ name, renewal }], nextCursor: null });
	expect(recentActivity().some((event) => event.id === renewal.eventId)).toBe(true);
	syncFeed({ items: [], nextCursor: null });
	expect(recentActivity().some((event) => event.id === renewal.eventId)).toBe(false);
});
