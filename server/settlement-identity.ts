export type SettlementIdentityEvent = {
	eventId: string;
	eventFamily: string;
	eventType: string;
	logIndex: number;
	canonical: boolean;
	facts: Record<string, unknown>;
};

export type SettlementEventBundle = {
	renewal: SettlementIdentityEvent;
	claim?: SettlementIdentityEvent;
	ensRenewal?: SettlementIdentityEvent;
};

export type ExpectedCctpSettlement = {
	sourceDomain: string;
	nonce: string;
	walletAddress: string;
	burnAmount: string;
};

function fact(event: SettlementIdentityEvent, key: string): string {
	return String(event.facts[key] ?? "");
}

function matchesEnsRenewal(
	event: SettlementIdentityEvent,
	renewal: SettlementIdentityEvent,
): boolean {
	return event.eventFamily === "ens"
		&& event.eventType === "NameRenewed"
		&& fact(event, "label") === fact(renewal, "label")
		&& fact(event, "duration") === fact(renewal, "duration")
		&& fact(event, "amount") === fact(renewal, "amount_applied");
}

/**
 * Split one transaction into helper-call segments.
 *
 * `CCTPClaimed` starts a CCTP segment. `Renewed` ends every segment. This
 * keeps two calls in one transaction independent, including equal payments
 * for the same name.
 */
export function settlementEventBundles(
	events: readonly SettlementIdentityEvent[],
): SettlementEventBundle[] {
	const ordered = [...events].sort((left, right) => left.logIndex - right.logIndex);
	const helperEvents = ordered.filter((event) =>
		event.eventFamily === "namepass"
		&& (event.eventType === "CCTPClaimed" || event.eventType === "Renewed"));
	const bundles: SettlementEventBundle[] = [];

	for (let index = 0; index < helperEvents.length; index += 1) {
		const renewal = helperEvents[index]!;
		if (renewal.eventType !== "Renewed") continue;
		const previousHelper = helperEvents[index - 1];
		const fromCctp = fact(renewal, "from_cctp") === "true";
		const claim = fromCctp && previousHelper?.eventType === "CCTPClaimed"
			? previousHelper
			: undefined;
		const lowerLogIndex = previousHelper?.logIndex ?? -1;
		const ensMatches = ordered.filter((event) =>
			event.logIndex > lowerLogIndex
			&& event.logIndex < renewal.logIndex
			&& matchesEnsRenewal(event, renewal));
		bundles.push({
			renewal,
			...(claim ? { claim } : {}),
			...(ensMatches.length === 1 ? { ensRenewal: ensMatches[0] } : {}),
		});
	}
	return bundles;
}

/** Find the one helper-call segment that contains this indexed event. */
export function settlementBundleForEvent(
	events: readonly SettlementIdentityEvent[],
	eventId: string,
): SettlementEventBundle | undefined {
	const matches = settlementEventBundles(events).filter((bundle) =>
		bundle.renewal.eventId === eventId || bundle.claim?.eventId === eventId);
	if (matches.length > 1) throw new Error("One settlement event belongs to multiple helper calls.");
	return matches[0];
}

/** Find the renewal that owns one exact ENS event. */
export function settlementBundleForEnsEvent(
	events: readonly SettlementIdentityEvent[],
	eventId: string,
): SettlementEventBundle | undefined {
	const matches = settlementEventBundles(events).filter((bundle) =>
		bundle.ensRenewal?.eventId === eventId);
	if (matches.length > 1) throw new Error("One ENS renewal belongs to multiple helper calls.");
	return matches[0];
}

/** Verify that Circle and Namepass describe the same exact helper call. */
export function assertCctpSettlementPair(bundle: SettlementEventBundle): void {
	if (fact(bundle.renewal, "from_cctp") !== "true") return;
	if (!bundle.claim) throw new Error("The CCTP renewal does not have an exact claim event.");
	const burnAmount = BigInt(fact(bundle.claim, "burn_amount"));
	const feeExecuted = BigInt(fact(bundle.claim, "fee_executed"));
	const mintedAmount = BigInt(fact(bundle.claim, "minted_amount"));
	if (
		fact(bundle.claim, "wallet_address").toLowerCase()
			!== fact(bundle.renewal, "wallet_address").toLowerCase()
		|| feeExecuted > burnAmount
		|| burnAmount - feeExecuted !== mintedAmount
		|| mintedAmount !== BigInt(fact(bundle.renewal, "amount_received"))
	) {
		throw new Error("The CCTP claim does not match its exact renewal event.");
	}
}

/** Verify that one exact settlement bundle belongs to one source message. */
export function assertExactCctpSettlement(
	bundle: SettlementEventBundle,
	expected: ExpectedCctpSettlement,
): void {
	if (!bundle.renewal.canonical || !bundle.claim?.canonical) {
		throw new Error("The exact CCTP settlement bundle is not canonical.");
	}
	if (fact(bundle.renewal, "from_cctp") !== "true" || !bundle.claim) {
		throw new Error("The external settlement does not match an exact CCTP claim.");
	}
	assertCctpSettlementPair(bundle);
	let claimNonce: string;
	try {
		claimNonce = BigInt(fact(bundle.claim, "nonce")).toString();
	} catch {
		throw new Error("The exact CCTP claim has an invalid nonce.");
	}
	if (
		fact(bundle.claim, "source_domain") !== expected.sourceDomain
		|| claimNonce !== expected.nonce
		|| fact(bundle.claim, "wallet_address").toLowerCase()
			!== expected.walletAddress.toLowerCase()
		|| fact(bundle.claim, "burn_amount") !== expected.burnAmount
	) {
		throw new Error("The exact CCTP claim does not match the source message.");
	}
}
