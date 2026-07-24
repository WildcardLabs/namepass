/**
 * Exact ENS v2 StandardRentPriceOracle pricing.
 *
 * Values are taken from the deployed contract's constructor arguments.
 * All arithmetic is BigInt; `divCeil` mirrors the contract's
 * `Math.Rounding.Ceil` in `_toAmount`, so results match on-chain to the
 * micro-unit.
 *
 * Base rates are per-second, indexed by character count:
 *   1–2 chars  unavailable
 *   3 chars    20_280_377
 *   4 chars     5_070_095
 *   5+ chars       253_505
 */

export const DENOM = 100000000000000000000000000000000000000n; // 1e38
export const YEAR_SECONDS = 31557600n;

/** Per-second base rate by label length. Index 0/1 are invalid. */
export const BASE_RATE_PER_CP = [0n, 0n, 20280377n, 5070095n, 253505n];

export function rateFor(labelLength: number): bigint {
	if (labelLength < 3) return 0n;
	if (labelLength === 3) return BASE_RATE_PER_CP[2];
	if (labelLength === 4) return BASE_RATE_PER_CP[3];
	return BASE_RATE_PER_CP[4];
}

export interface Tier {
	/** Minimum duration in seconds at which this rate applies. */
	start: bigint;
	/** Discount numerator over DENOM. */
	numer: bigint;
	/** Human-facing discount label, e.g. "43.75%". */
	off: string;
	/** Whole years this tier corresponds to. */
	years: number;
}

export const TIERS: Tier[] = [
	{ start: 189345600n, numer: 56250000000000000000000000000000000000n, off: "43.75%", years: 6 },
	{ start: 94672800n, numer: 68750000000000000000000000000000000000n, off: "31.25%", years: 3 },
	{ start: 63115200n, numer: 87500000000000000000000000000000000000n, off: "12.5%", years: 2 },
	{ start: 0n, numer: DENOM, off: "", years: 0 },
];

export const divCeil = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Minimum USDC (6dp micro-units) to reach a tier, for a given label length. */
export function tierCost(tier: Tier, labelLength: number): bigint {
	const rate = rateFor(labelLength);
	if (rate === 0n) return 0n;
	return divCeil((rate * tier.start * tier.numer) / DENOM, 1000000n);
}

/** Cost of an arbitrary duration at full price. */
export function costOf(seconds: bigint, labelLength: number): bigint {
	const rate = rateFor(labelLength);
	return divCeil((rate * seconds * DENOM) / DENOM, 1000000n);
}

/** Longest renewal a budget buys, and the rate it lands on. */
export function solve(
	budgetMicro: bigint,
	labelLength = 5,
): { seconds: bigint; off: string; tierYears: number } {
	const rate = rateFor(labelLength);
	if (rate === 0n) return { seconds: 0n, off: "", tierYears: 0 };
	for (const tier of TIERS) {
		if (budgetMicro >= tierCost(tier, labelLength)) {
			const seconds =
				((budgetMicro * 1000000n + 1n) * DENOM - 1n) / (rate * tier.numer);
			return { seconds, off: tier.off, tierYears: tier.years };
		}
	}
	return { seconds: 0n, off: "", tierYears: 0 };
}

/** The three discount thresholds for a label length, cheapest first. */
export function thresholds(labelLength: number) {
	return TIERS.slice(0, 3)
		.map((t) => ({ tier: t, cost: tierCost(t, labelLength) }))
		.reverse();
}

/** One year at full price, for a label length. */
export function oneYearCost(labelLength: number): bigint {
	return costOf(YEAR_SECONDS, labelLength);
}

/** Round micro-USDC up to the next whole cent — payable, and always clears the tier. */
export function ceilToCent(micro: bigint): bigint {
	return ((micro + 9999n) / 10000n) * 10000n;
}

/** Payable button amounts for each threshold: exact cost rounded up to a cent. */
export function payableThresholds(labelLength: number) {
	return thresholds(labelLength).map((t) => ({
		years: t.tier.years,
		off: t.tier.off,
		exact: t.cost,
		payable: ceilToCent(t.cost),
	}));
}

export interface NextTierHint {
	years: number;
	off: string;
	payable: bigint;
	/** Extra USDC needed to reach it. */
	delta: bigint;
	/** Seconds gained by topping up. */
	gain: bigint;
}

/**
 * If a small top-up would cross into a much better rate, describe it.
 * Returns null when already at the best rate, or when the jump isn't close.
 */
export function nextTierHint(
	budgetMicro: bigint,
	labelLength: number,
	proximity = 0.35,
): NextTierHint | null {
	const current = solve(budgetMicro, labelLength);
	for (const t of payableThresholds(labelLength)) {
		if (budgetMicro >= t.payable) continue;
		const delta = t.payable - budgetMicro;
		/* Only surface it if the top-up is small relative to what they've already put in. */
		if (budgetMicro > 0n && Number(delta) > Number(budgetMicro) * proximity) return null;
		const after = solve(t.payable, labelLength);
		const gain = after.seconds - current.seconds;
		if (gain <= 0n) return null;
		return { years: t.years, off: t.off, payable: t.payable, delta, gain };
	}
	return null;
}
