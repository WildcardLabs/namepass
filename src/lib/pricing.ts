/**
 * Exact ENS v2 StandardRentPriceOracle pricing for 5+ character names.
 *
 * Values are taken from the deployed contract's constructor arguments.
 * All arithmetic is BigInt; `divCeil` mirrors the contract's
 * `Math.Rounding.Ceil` in `_toAmount`, so results match on-chain to the
 * micro-unit.
 *
 * Verified thresholds (minimum spend to reach each bulk rate):
 *   1 year  → $8.000010   (no discount)
 *   2 years → $14.000017  (12.5% off)
 *   3 years → $16.500020  (31.25% off)
 *   6 years → $27.000032  (43.75% off)
 */

export const DENOM = 100000000000000000000000000000000000000n; // 1e38
export const YEAR_SECONDS = 31557600n;
export const RATE_PER_SECOND = 253505n;

export interface Tier {
	/** Minimum duration in seconds at which this rate applies. */
	start: bigint;
	/** Discount numerator over DENOM. */
	numer: bigint;
	/** Human-facing discount label. */
	off: string;
}

export const TIERS: Tier[] = [
	{ start: 189345600n, numer: 56250000000000000000000000000000000000n, off: "43.75% off" },
	{ start: 94672800n, numer: 68750000000000000000000000000000000000n, off: "31.25% off" },
	{ start: 63115200n, numer: 87500000000000000000000000000000000000n, off: "12.5% off" },
	{ start: 0n, numer: DENOM, off: "" },
];

export const divCeil = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Minimum USDC (6dp micro-units) required to reach a given tier. */
export function tierCost(tier: Tier): bigint {
	return divCeil((RATE_PER_SECOND * tier.start * tier.numer) / DENOM, 1000000n);
}

/** Longest renewal a budget can buy, and the rate it lands on. */
export function solve(budgetMicro: bigint): { seconds: bigint; off: string } {
	for (const tier of TIERS) {
		if (budgetMicro >= tierCost(tier)) {
			const seconds =
				((budgetMicro * 1000000n + 1n) * DENOM - 1n) /
				(RATE_PER_SECOND * tier.numer);
			return { seconds, off: tier.off };
		}
	}
	return { seconds: 0n, off: "" };
}
