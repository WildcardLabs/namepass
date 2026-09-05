import assert from "node:assert/strict";
import test from "node:test";

import {
	assertCctpSettlementPair,
	assertExactCctpSettlement,
	settlementBundleForEnsEvent,
	settlementBundleForEvent,
	settlementEventBundles,
	type SettlementIdentityEvent,
} from "./settlement-identity";

function event(
	eventId: string,
	eventFamily: string,
	eventType: string,
	logIndex: number,
	facts: Record<string, unknown>,
): SettlementIdentityEvent {
	return { eventId, eventFamily, eventType, logIndex, canonical: true, facts };
}

function call(id: string, firstLog: number, wallet: string, nonce: string) {
	const burnAmount = id === "a" ? "5000000" : "7000000";
	const amountApplied = id === "a" ? "4800000" : "6800000";
	return [
		event(`${id}-claim`, "namepass", "CCTPClaimed", firstLog, {
			nonce: `0x${BigInt(nonce).toString(16).padStart(64, "0")}`,
			wallet_address: wallet,
			source_domain: "6",
			burn_amount: burnAmount,
			fee_executed: "100000",
			minted_amount: String(BigInt(burnAmount) - 100000n),
		}),
		event(`${id}-ens`, "ens", "NameRenewed", firstLog + 3, {
			label: id,
			duration: "31536000",
			amount: amountApplied,
			new_expiry: id === "a" ? "2000000000" : "2100000000",
		}),
		event(`${id}-renewal`, "namepass", "Renewed", firstLog + 5, {
			label: id,
			wallet_address: wallet,
			from_cctp: "true",
			duration: "31536000",
			amount_received: String(BigInt(burnAmount) - 100000n),
			amount_applied: amountApplied,
		}),
	];
}

test("batched CCTP calls keep each claim, ENS event, and renewal together", () => {
	const events = [
		...call("a", 10, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1"),
		...call("b", 30, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "2"),
	];
	const bundles = settlementEventBundles(events);
	assert.equal(bundles.length, 2);
	assert.equal(bundles[0]?.claim?.eventId, "a-claim");
	assert.equal(bundles[0]?.ensRenewal?.eventId, "a-ens");
	assert.equal(bundles[1]?.claim?.eventId, "b-claim");
	assert.equal(bundles[1]?.ensRenewal?.eventId, "b-ens");
	assert.equal(settlementBundleForEvent(events, "b-claim")?.renewal.eventId, "b-renewal");
	assert.equal(settlementBundleForEnsEvent(events, "a-ens")?.renewal.eventId, "a-renewal");
	for (const bundle of bundles) assert.doesNotThrow(() => assertCctpSettlementPair(bundle));
});

test("equal claims for one name still use log identity", () => {
	const first = call("a", 10, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1");
	const second = call("a", 30, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "2");
	second[0] = { ...second[0]!, eventId: "second-claim", facts: { ...second[0]!.facts, nonce: "2" } };
	second[1] = { ...second[1]!, eventId: "second-ens" };
	second[2] = { ...second[2]!, eventId: "second-renewal" };
	const bundles = settlementEventBundles([...first, ...second]);
	assert.equal(bundles[0]?.claim?.eventId, "a-claim");
	assert.equal(bundles[1]?.claim?.eventId, "second-claim");
});

test("a mismatched claim cannot supply settlement facts", () => {
	const events = call("a", 10, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1");
	events[2] = {
		...events[2]!,
		facts: { ...events[2]!.facts, wallet_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
	};
	const bundle = settlementEventBundles(events)[0]!;
	assert.throws(() => assertCctpSettlementPair(bundle), /does not match/);
});

test("an exact CCTP bundle must match all source-message identity fields", () => {
	const walletAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	const bundle = settlementEventBundles(call("a", 10, walletAddress, "1"))[0]!;
	const expected = {
		sourceDomain: "6",
		nonce: "1",
		walletAddress,
		burnAmount: "5000000",
	};
	assert.doesNotThrow(() => assertExactCctpSettlement(bundle, expected));
	for (const mismatch of [
		{ sourceDomain: "3" },
		{ nonce: "2" },
		{ walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
		{ burnAmount: "7000000" },
	]) {
		assert.throws(
			() => assertExactCctpSettlement(bundle, { ...expected, ...mismatch }),
			/does not match/,
		);
	}
});

test("an exact CCTP bundle must keep both settlement events canonical", () => {
	const events = call("a", 10, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1");
	events[0] = { ...events[0]!, canonical: false };
	const bundle = settlementEventBundles(events)[0]!;
	assert.throws(() => assertExactCctpSettlement(bundle, {
		sourceDomain: "6",
		nonce: "1",
		walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		burnAmount: "5000000",
	}), /not canonical/);
});
