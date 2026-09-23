import { expect, test } from "vitest";

import { activeFlows, activityEmptyState, canRecheckName, canTrigger, findName, flowAmount, hasActiveFlow, leaderboardNames, recentActivity, renewalEvent, syncFeed, syncLeaderboard, syncName } from "./readModel";
import { PUBLIC_CHAINS } from "./chains";
import { setRates } from "./pricing";
import type { PublicFlow } from "./publicApi";
import { setPublicConfig } from "./triggerConfig";

function flow(overrides: Partial<PublicFlow>): PublicFlow {
	return {
		id: "flow",
		originChainId: "84532",
		trigger: "automatic",
		status: "queued",
		holdReason: null,
		amountDetected: "500000",
		amountProcessed: null,
		remainingAmount: null,
		gasAllowance: null,
		amountApplied: null,
		durationSeconds: null,
		cctpNonce: null,
		lastErrorCode: null,
		nextActionAt: null,
		queuedAt: "2026-08-11T00:00:00.000Z",
		confirmingDepositAt: null,
		checkingNameAt: null,
		submittingOriginAt: null,
		waitingOriginAt: null,
		waitingAttestationAt: null,
		submittingClaimAt: null,
		waitingClaimAt: null,
		heldAt: null,
		unclaimedAt: null,
		settledAt: null,
		cancelledAt: null,
		failedAt: null,
		createdAt: "2026-08-11T00:00:00.000Z",
		updatedAt: "2026-08-11T00:00:00.000Z",
		...overrides,
	};
}

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
	expect(event.funder).toBe("Sender unavailable — deposit not linked");
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

	syncFeed({ items: [{ name, renewal }], flows: [], nextCursor: null });
	expect(recentActivity().some((event) => event.id === renewal.eventId)).toBe(true);
	syncFeed({ items: [], flows: [], nextCursor: null });
	expect(recentActivity().some((event) => event.id === renewal.eventId)).toBe(false);
});

test("the global feed exposes active flows without opening a name", () => {
	const name = {
		label: "live-test",
		displayName: "live-test.eth",
		depositAddress: "0x0000000000000000000000000000000000000005",
		activatedAt: "2026-08-10T00:00:00.000Z",
		currentExpiry: null,
		renewableBy: "registrar" as const,
		ensSyncedAt: "2026-08-10T00:00:00.000Z",
		unscannedChainIds: [],
		lifetimeReceived: "0",
		lifetimeApplied: "0",
		timeDeliveredSeconds: "0",
		renewalCount: "0",
	};
	syncFeed({ items: [], flows: [{ name, flow: flow({ id: "live-flow" }) }], nextCursor: null });
	expect(findName(name.displayName)?.address).toBe(name.depositAddress);
	expect(activeFlows().map((item) => item.id)).toContain("live-flow");
});

test("pending balances do not count money owned by an active flow twice", () => {
	setPublicConfig({
		chains: PUBLIC_CHAINS.map((chain) => ({
			chainId: chain.chainId,
			minimumTriggerAmount: "500000",
		})),
	});
	const record = syncName({
		name: {
			label: "pending-test",
			displayName: "pending-test.eth",
			depositAddress: "0x0000000000000000000000000000000000000004",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: "2027-08-10T00:00:00.000Z",
			renewableBy: "registrar",
			ensSyncedAt: "2026-08-11T00:00:00.000Z",
			unscannedChainIds: [],
			lifetimeReceived: "0",
			lifetimeApplied: "0",
			timeDeliveredSeconds: "0",
			renewalCount: "0",
		},
		renewals: [],
		flows: [
			flow({ id: "active", originChainId: "84532", status: "confirming_deposit" }),
			flow({ id: "bridging", originChainId: "5042002", status: "waiting_attestation" }),
			flow({ id: "reverted", originChainId: "11155111", status: "held", holdReason: "origin_reverted" }),
		],
		balances: [
			{ chainId: "421614", amount: "300000" },
			{ chainId: "84532", amount: "500000" },
			{ chainId: "5042002", amount: "700000" },
			{ chainId: "11155111", amount: "500000" },
		],
		nextCursor: null,
	});
	const reason = (chainId: string) => record.pending.balances.find((balance) => balance.chainId === chainId)?.holdReason;
	expect(reason("421614")).toBe("below_threshold");
	expect(reason("84532")).toBeUndefined();
	expect(reason("5042002")).toBe("not_detected");
	expect(reason("11155111")).toBe("flow_failed");
	expect(record.pending.flows.find((active) => active.id === "active")?.status).toBe("confirming_deposit");
});

test("the browser keeps every same-chain post-burn flow and shows new wallet funds separately", () => {
	setPublicConfig({
		chains: PUBLIC_CHAINS.map((chain) => ({ chainId: chain.chainId, minimumTriggerAmount: "500000" })),
	});
	const record = syncName({
		name: {
			label: "same-chain-test",
			displayName: "same-chain-test.eth",
			depositAddress: "0x0000000000000000000000000000000000000014",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: "2027-08-10T00:00:00.000Z",
			renewableBy: "registrar",
			ensSyncedAt: "2026-08-11T00:00:00.000Z",
			unscannedChainIds: ["84532"],
			lifetimeReceived: "0",
			lifetimeApplied: "0",
			timeDeliveredSeconds: "0",
			renewalCount: "0",
		},
		renewals: [],
		flows: [
			flow({ id: "base-attestation-1", status: "waiting_attestation", amountProcessed: "7000000" }),
			flow({ id: "base-attestation-2", status: "waiting_attestation", amountProcessed: "8000000" }),
		],
		balances: [{ chainId: "84532", amount: "900000" }],
		nextCursor: null,
	});

	expect(record.pending.flows.map((item) => item.id)).toEqual([
		"base-attestation-1",
		"base-attestation-2",
	]);
	expect(record.pending.balances).toEqual([{
		chainId: "84532",
		chain: "Base",
		amount: 900000n,
		holdReason: "scan_pending",
		flowErrorCode: undefined,
	}]);
	expect(canTrigger(record.pending, record.pending.balances[0]!)).toBe(false);
});

test("an inactive name never presents a held balance as queued behind a renewal", () => {
	setPublicConfig({
		chains: PUBLIC_CHAINS.map((chain) => ({ chainId: chain.chainId, minimumTriggerAmount: "500000" })),
	});
	const record = syncName({
		name: {
			label: "inactive-test",
			displayName: "inactive-test.eth",
			depositAddress: "0x0000000000000000000000000000000000000008",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: null,
			renewableBy: null,
			ensSyncedAt: "2026-08-10T00:00:00.000Z",
			unscannedChainIds: [],
			lifetimeReceived: "0",
			lifetimeApplied: "0",
			timeDeliveredSeconds: "0",
			renewalCount: "0",
		},
		renewals: [],
		flows: [flow({ status: "held", holdReason: null, originChainId: "11155111" })],
		balances: [{ chainId: "11155111", amount: "510000" }],
		nextCursor: null,
	});

	expect(record.pending.flows).toEqual([]);
	expect(record.pending.balances).toEqual([{
		chainId: "11155111",
		chain: "Ethereum",
		amount: 510000n,
		holdReason: "name_inactive",
		flowErrorCode: null,
	}]);
	expect(activityEmptyState(record)).toBe("no_completed_renewals");
	expect(canRecheckName(record.pending.balances[0]!)).toBe(true);
});

test("an inactive balance must meet its chain minimum before ENS can be rechecked", () => {
	expect(canRecheckName({
		chainId: "11155111",
		chain: "Ethereum",
		amount: 499999n,
		holdReason: "name_inactive",
	})).toBe(false);
});

test("historical renewals remain activity when the name becomes inactive and receives more funds", () => {
	setRates({
		oracle: "0x0000000000000000000000000000000000000001",
		denom: 100n,
		baseRates: [1n, 1n, 1n, 1n, 1n],
		points: [{ duration: 2n, numer: 50n }],
		tokenNumer: 1n,
		tokenDenom: 1n,
		readAt: 0,
	});
	const record = syncName({
		name: {
			label: "inactive-history-test",
			displayName: "inactive-history-test.eth",
			depositAddress: "0x0000000000000000000000000000000000000009",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: null,
			renewableBy: null,
			ensSyncedAt: "2026-08-24T00:00:00.000Z",
			unscannedChainIds: [],
			lifetimeReceived: "2000000",
			lifetimeApplied: "1900000",
			timeDeliveredSeconds: "180",
			renewalCount: "1",
		},
		renewals: [{
			eventId: "historical-renewal",
			flowId: "settled-flow",
			originChainId: "84532",
			funderAddress: "0x0000000000000000000000000000000000000010",
			executorAddress: "0x0000000000000000000000000000000000000011",
			executorIsRelayer: true,
			amountReceived: "2000000",
			gasAllowance: "100000",
			amountApplied: "1900000",
			durationSeconds: "180",
			expiryAfter: "2026-08-12T00:00:00.000Z",
			fromCctp: true,
			depositTxHash: `0x${"1".repeat(64)}`,
			originTxHash: `0x${"2".repeat(64)}`,
			claimTxHash: `0x${"3".repeat(64)}`,
			renewalTxHash: `0x${"3".repeat(64)}`,
			blockTime: "2026-08-11T00:00:00.000Z",
		}],
		flows: [flow({ id: "new-held-flow", status: "held", holdReason: "name_not_renewable", originChainId: "11155111" })],
		balances: [{ chainId: "11155111", amount: "510000" }],
		nextCursor: null,
	});

	expect(record.events.filter((event) => event.kind === "renewal").map((event) => event.id)).toEqual(["historical-renewal"]);
	expect(record.pending.balances[0]?.holdReason).toBe("name_inactive");
	expect(activityEmptyState(record)).toBeNull();
});

test("activity distinguishes a new Namepass from one with a payment in progress", () => {
	const base = {
		label: "empty-activity-test",
		displayName: "empty-activity-test.eth",
		depositAddress: "0x0000000000000000000000000000000000000012",
		activatedAt: "2026-08-24T00:00:00.000Z",
		currentExpiry: "2027-08-24T00:00:00.000Z",
		renewableBy: "registrar" as const,
		ensSyncedAt: "2026-08-24T00:00:00.000Z",
		unscannedChainIds: [],
		lifetimeReceived: "0",
		lifetimeApplied: "0",
		timeDeliveredSeconds: "0",
		renewalCount: "0",
	};
	const empty = syncName({ name: base, renewals: [], flows: [], balances: [], nextCursor: null });
	expect(activityEmptyState(empty)).toBe("waiting_first_payment");

	const processing = syncName({
		name: base,
		renewals: [],
		flows: [flow({ status: "waiting_attestation", originChainId: "421614" })],
		balances: [{ chainId: "421614", amount: "0" }],
		nextCursor: null,
	});
	expect(activityEmptyState(processing)).toBe("no_completed_renewals");
});

test("post-origin flow displays use the amount proven by the origin receipt", () => {
	expect(flowAmount(flow({ amountDetected: "500000", amountProcessed: null }))).toBe(500000n);
	expect(flowAmount(flow({ amountDetected: "500000", amountProcessed: "700000" }))).toBe(700000n);
});

test("a visible stopped flow explains the eligible balance and enables retry", () => {
	setPublicConfig({
		chains: PUBLIC_CHAINS.map((chain) => ({ chainId: chain.chainId, minimumTriggerAmount: "500000" })),
	});
	const record = syncName({
		name: {
			label: "stopped-test",
			displayName: "stopped-test.eth",
			depositAddress: "0x0000000000000000000000000000000000000008",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: "2027-08-10T00:00:00.000Z",
			renewableBy: "registrar",
			ensSyncedAt: "2026-08-11T00:00:00.000Z",
			unscannedChainIds: [],
			lifetimeReceived: "0",
			lifetimeApplied: "0",
			timeDeliveredSeconds: "0",
			renewalCount: "0",
		},
		renewals: [],
		flows: [flow({ status: "cancelled", lastErrorCode: "empty_wallet" })],
		balances: [{ chainId: "84532", amount: "20000000" }],
		nextCursor: null,
	});
	const balance = record.pending.balances[0]!;
	expect(record.pending.flows).toEqual([]);
	expect(balance.holdReason).toBe("flow_failed");
	expect(balance.flowErrorCode).toBe("empty_wallet");
	expect(canTrigger(record.pending, balance)).toBe(true);
});

test("held and unclaimed flows do not keep the fast active-flow poll", () => {
	const record = syncName({
		name: {
			label: "poll-test",
			displayName: "poll-test.eth",
			depositAddress: "0x0000000000000000000000000000000000000006",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: "2027-08-10T00:00:00.000Z",
			renewableBy: "registrar",
			ensSyncedAt: "2026-08-11T00:00:00.000Z",
			unscannedChainIds: [],
			lifetimeReceived: "0",
			lifetimeApplied: "0",
			timeDeliveredSeconds: "0",
			renewalCount: "0",
		},
		renewals: [],
		flows: [flow({ status: "unclaimed" })],
		balances: [],
		nextCursor: null,
	});
	expect(hasActiveFlow(record)).toBe(false);
	record.flows = [flow({ status: "waiting_attestation" })];
	expect(hasActiveFlow(record)).toBe(true);
});

test("leaderboard names contain only the latest leaderboard response", () => {
	const base = {
		depositAddress: "0x0000000000000000000000000000000000000007",
		activatedAt: "2026-08-10T00:00:00.000Z",
		currentExpiry: null,
		renewableBy: "registrar" as const,
		ensSyncedAt: "2026-08-10T00:00:00.000Z",
		unscannedChainIds: [],
		lifetimeReceived: "0",
		lifetimeApplied: "0",
		timeDeliveredSeconds: "0",
		renewalCount: "1",
	};
	syncLeaderboard({ items: [{ ...base, label: "first", displayName: "first.eth" }] });
	expect(leaderboardNames().map((record) => record.name)).toEqual(["first.eth"]);
	syncLeaderboard({ items: [{ ...base, label: "second", displayName: "second.eth" }] });
	expect(leaderboardNames().map((record) => record.name)).toEqual(["second.eth"]);
	syncLeaderboard({ items: [
		{ ...base, label: "ranked", displayName: "ranked.eth" },
		{ ...base, label: "empty", displayName: "empty.eth", renewalCount: "0" },
	] });
	expect(leaderboardNames().map((record) => record.name)).toEqual(["ranked.eth"]);
});

test("name lookup uses the same ENS normalization as address derivation", () => {
	const record = syncName({
		name: {
			label: "bücher",
			displayName: "bücher.eth",
			depositAddress: "0x0000000000000000000000000000000000000013",
			activatedAt: "2026-08-10T00:00:00.000Z",
			currentExpiry: "2027-08-10T00:00:00.000Z",
			renewableBy: "registrar",
			ensSyncedAt: "2026-08-11T00:00:00.000Z",
			unscannedChainIds: [],
			lifetimeReceived: "0",
			lifetimeApplied: "0",
			timeDeliveredSeconds: "0",
			renewalCount: "0",
		},
		renewals: [],
		flows: [],
		balances: [],
		nextCursor: null,
	});

	expect(findName("BÜCHER.ETH")).toBe(record);
	expect(findName("bu\u0308cher.eth")).toBe(record);
	expect(findName("sub.bücher.eth")).toBeUndefined();
});
