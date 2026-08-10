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
 *   3 chars    20_294_267
 *   4 chars     5_073_567
 *   5+ chars       253_679
 *
 * These are read from the deployed oracle, not derived. They correspond to
 * $640/$160/$8 per year over a 365-day year — do NOT re-derive them from a
 * Julian year (365.25 days, 31_557_600s). That mistake understated every rate
 * by ~0.07%, which reads as roughly six free hours per year purchased.
 */

export const DENOM = 100000000000000000000000000000000000000n; // 1e38

/**
 * 365 days. This is the oracle's year: `TIERS[].start` are exact multiples of
 * it, so it doubles as the seconds→years divisor for display. Changing it
 * silently moves every threshold and every "N years" label.
 */
export const YEAR_SECONDS = 31536000n;

/** Per-second base rate by label length. Index 0/1 are invalid. */
export const BASE_RATE_PER_CP = [0n, 0n, 20294267n, 5073567n, 253679n];

/**
 * Characters in a label, counted the way the oracle counts them.
 *
 * **Not `label.length`.** JavaScript's `String.length` is UTF-16 code
 * units, so anything above the BMP counts twice: `"😀😀😀".length` is
 * 6, and 6 selects the 5+ character rate — $8/year for a name ENS
 * prices as three characters at $640/year. The spread reaches 80x.
 *
 * The oracle indexes its base rates by **code point**, via a byte walk
 * over the UTF-8 label (`_strlen` in `contracts/ENSV2RenewalHelper.sol`,
 * itself a transcription of ENS's own). The string iterator is
 * code-point based, so spreading matches it.
 *
 * Follows ENS in counting emoji by code point: a ZWJ sequence is five
 * characters, not one, and a variation selector adds one.
 */
export function labelLength(label: string): number {
	return [...label].length;
}

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
	{ start: 189216000n, numer: 56250000000000000000000000000000000000n, off: "43.75%", years: 6 },
	{ start: 94608000n, numer: 68750000000000000000000000000000000000n, off: "31.25%", years: 3 },
	{ start: 63072000n, numer: 87500000000000000000000000000000000000n, off: "12.5%", years: 2 },
	/* The oracle's `getDiscountPoints()` returns only the three above. This
	   full-price entry is ours, standing in for the contract's post-loop
	   `duration = budget / rate` fallback — `start: 0` always matches, and at
	   `numer == DENOM` the tier formula reduces to exactly that floor divide. */
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
