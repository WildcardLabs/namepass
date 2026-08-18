/**
 * Exact ENS v2 `StandardRentPriceOracle` pricing.
 *
 * **The arithmetic lives here; the numbers do not.** Base rates, discount
 * tiers, the discount denominator and the USDC conversion ratio are read off
 * ENS's deployed oracle at boot by `oracle.ts` and installed with
 * `setRates()`. Nothing in this file decides what a name costs — it decides
 * how to invert what ENS charges, which is the one part that is genuinely
 * ours and is checked against the chain by `ENSV2RenewalHelper._quote`.
 *
 * All arithmetic is `BigInt`; `divCeil` mirrors the contract's
 * `Math.Rounding.Ceil` in `_toAmount`, so results match on chain to the
 * micro-unit.
 *
 * Every function below throws until `setRates()` has run. That is deliberate
 * and it is why there is no default: a fallback price is a made-up price, and
 * the failure mode of showing one is a funder sending an amount that buys less
 * than the screen promised. `App.tsx` gates the UI on the load instead.
 */

import type { OracleRates } from "./oracle";

/**
 * 365 days. **Not an oracle value** — ENS has no notion of a year, it prices
 * per second. This is a display convention, and it is the right one because
 * the oracle's tier durations are exact multiples of it: 63072000, 94608000
 * and 189216000 are 2, 3 and 6 of these. Deriving it from a Julian year
 * (365.25 days) understated every rate by ~0.07% once — see
 * `docs/DECISIONS.md`, 2026-08-06.
 *
 * If ENS ever sets a tier that isn't a whole multiple of this, `tiers()` says
 * so rather than rounding — see `yearsOf`.
 */
export const YEAR_SECONDS = 31536000n;

export class PricingNotLoadedError extends Error {
	constructor() {
		super("ENS pricing has not been read from the chain yet.");
		this.name = "PricingNotLoadedError";
	}
}

let loaded: OracleRates | null = null;

/** Install the configuration read from the chain. Called once, at boot. */
export function setRates(next: OracleRates): void {
	loaded = next;
}

/** The live configuration. Throws rather than guess. */
export function rates(): OracleRates {
	if (!loaded) throw new PricingNotLoadedError();
	return loaded;
}

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

/**
 * Per-second rate for a label length, straight out of the oracle's array.
 *
 * Mirrors `_rateFor` exactly, **including the off-by-one**: the index is
 * `length - 1`, so a 3-character name reads `baseRates[2]`. The length is
 * clamped to the array first, which is what makes the last entry cover
 * everything longer — a 40-character name pays the 5+ rate. A length the array
 * prices at zero is a name ENS won't sell; today that's anything under three
 * characters, and the contract reverts on it rather than charging nothing.
 */
export function rateFor(length: number): bigint {
	const { baseRates } = rates();
	if (length < 1 || baseRates.length === 0) return 0n;
	return baseRates[Math.min(length, baseRates.length) - 1] ?? 0n;
}

export interface Tier {
	/** Minimum duration in seconds at which this rate applies. */
	start: bigint;
	/** Discount numerator over the oracle's denominator. */
	numer: bigint;
	/** Human-facing discount label, e.g. `"43.75%"`. Empty at full price. */
	off: string;
	/** Whole years this tier corresponds to, `0` at full price. */
	years: number;
}

/**
 * Whole years in a duration, or `0` if it isn't a whole number of them.
 *
 * The quick-select buttons are labelled "2y / 3y / 6y", which is only honest
 * while ENS's tiers land on whole years. They do today. If one ever doesn't,
 * this returns 0 and the UI shows the amount without a year label rather than
 * rounding 2.5 years to "2y" beside a price that buys more than that.
 */
function yearsOf(seconds: bigint): number {
	return seconds % YEAR_SECONDS === 0n ? Number(seconds / YEAR_SECONDS) : 0;
}

/**
 * Percentage off, from the tier's multiplier. `numer/denom` is what you pay,
 * so the discount is the rest. Trailing zeros are trimmed: `12.5%`, not
 * `12.50%`.
 */
function offLabel(numer: bigint, denom: bigint): string {
	const bps = ((denom - numer) * 10000n) / denom;
	if (bps === 0n) return "";
	const whole = bps / 100n;
	const frac = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
	return frac ? `${whole}.${frac}%` : `${whole}%`;
}

/**
 * Discount tiers, best first — the order `solve` walks, where the first
 * affordable tier is necessarily the optimal one. `oracle.ts` has already
 * asserted the ordering that makes that true.
 *
 * The last entry is **ours**: a full-price tier standing in for the contract's
 * post-loop `duration = budget / rate` fallback. `start: 0` always matches,
 * and at `numer == denom` the tier formula reduces to exactly that floor
 * divide, so one loop covers both.
 */
export function tiers(): Tier[] {
	const { points, denom } = rates();
	const discounted = points
		.map((p) => ({
			start: p.duration,
			numer: p.numer,
			off: offLabel(p.numer, denom),
			years: yearsOf(p.duration),
		}))
		.sort((a, b) => (b.start > a.start ? 1 : b.start < a.start ? -1 : 0));

	return [...discounted, { start: 0n, numer: denom, off: "", years: 0 }];
}

export const divCeil = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/**
 * ENS's standard-unit → payment-token conversion: `ceil(value * numer / denom)`.
 *
 * Two values, not one. Treating the ratio as a single divisor is only right
 * while `numer` is 1 — which it is today — and silently mis-prices the moment
 * ENS configures it otherwise. `_toPaymentUnits` in the helper is the same
 * expression.
 */
function toPaymentUnits(standard: bigint): bigint {
	const { tokenNumer, tokenDenom } = rates();
	return divCeil(standard * tokenNumer, tokenDenom);
}

/** Minimum USDC (6dp micro-units) to reach a tier, for a given label length. */
export function tierCost(tier: Tier, length: number): bigint {
	const rate = rateFor(length);
	if (rate === 0n) return 0n;
	return toPaymentUnits((rate * tier.start * tier.numer) / rates().denom);
}

/** Cost of an arbitrary duration at full price. */
export function costOf(seconds: bigint, length: number): bigint {
	return toPaymentUnits(rateFor(length) * seconds);
}

/** Longest renewal a budget buys, and the rate it lands on. */
export function solve(
	budgetMicro: bigint,
	length = 5,
): { seconds: bigint; off: string; tierYears: number } {
	const rate = rateFor(length);
	if (rate === 0n) return { seconds: 0n, off: "", tierYears: 0 };

	const { denom, tokenNumer, tokenDenom } = rates();

	/*
	 * Invert ENS's payment conversion. Forward it charges
	 * `ceil(standard * numer / denom)`, so a token budget affords every
	 * standard price S with `S <= floor(budget * denom / numer)`.
	 */
	const budget = (budgetMicro * tokenDenom) / tokenNumer;

	for (const tier of tiers()) {
		if (budgetMicro >= tierCost(tier, length)) {
			/* Exact inverse of the contract's floor, matching `_quote`. */
			const seconds = ((budget + 1n) * denom - 1n) / (rate * tier.numer);
			return { seconds, off: tier.off, tierYears: tier.years };
		}
	}
	return { seconds: 0n, off: "", tierYears: 0 };
}

/** The discount thresholds for a label length, cheapest first. */
export function thresholds(length: number) {
	return tiers()
		.filter((t) => t.start > 0n)
		.map((t) => ({ tier: t, cost: tierCost(t, length) }))
		.reverse();
}

/** One year at full price, for a label length. */
export function oneYearCost(length: number): bigint {
	return costOf(YEAR_SECONDS, length);
}

/** Round micro-USDC up to the next whole cent — payable, and always clears the tier. */
export function ceilToCent(micro: bigint): bigint {
	return ((micro + 9999n) / 10000n) * 10000n;
}

/**
 * Payable button amounts for each threshold: exact cost rounded up to a cent.
 *
 * **No one-year entry**, and that's a positioning decision rather than an
 * oversight — see `docs/DECISIONS.md` (2026-08-06) before adding one. What
 * comes back is whatever discount tiers ENS currently publishes, so if
 * governance adds or drops one, the quick-selects follow.
 */
export function payableThresholds(length: number) {
	return thresholds(length).map((t) => ({
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
	length: number,
	proximity = 0.35,
): NextTierHint | null {
	const current = solve(budgetMicro, length);
	for (const t of payableThresholds(length)) {
		if (budgetMicro >= t.payable) continue;
		const delta = t.payable - budgetMicro;
		/* Only surface it if the top-up is small relative to what they've already put in. */
		if (budgetMicro > 0n && Number(delta) > Number(budgetMicro) * proximity) return null;
		const after = solve(t.payable, length);
		const gain = after.seconds - current.seconds;
		if (gain <= 0n) return null;
		return { years: t.years, off: t.off, payable: t.payable, delta, gain };
	}
	return null;
}
