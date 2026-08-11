/**
 * ENS's live pricing configuration, read from the chain.
 *
 * `pricing.ts` does the arithmetic; this module supplies the numbers it does
 * it with. Nothing here is a constant that a person typed — the base rates,
 * the discount tiers, the discount denominator and the USDC conversion ratio
 * all come off ENS's own `StandardRentPriceOracle` at boot, the same values
 * `ENSV2RenewalHelper._quote` reads on every renewal.
 *
 * **How the oracle is found matters.** It is not pinned. The helper reads
 * `rentPriceOracle()` off the renewer it is about to call, deliberately —
 * "reading the oracle from anywhere other than the contract about to be called
 * is how the three-way agreement stops being an invariant." Same reasoning
 * here: the two renewer addresses are pinned, and the oracle is whatever they
 * currently say it is. ENS governance can repoint an oracle without telling us
 * and the app follows; it would take a change to the *renewers* to strand this.
 *
 * The one thing this can't do is pick per label. The helper selects a renewer
 * with `isRenewable(label)` and prices against that one's oracle; the app shows
 * a generic table for 3 / 4 / 5+ characters, which has no label to select with.
 * So it reads both renewers' oracles and requires them to agree. Today they do
 * — both Sepolia renewers point at `0x8914b662…` (`docs/DEPLOYMENTS.md`). If
 * they ever diverge there is no single price table to draw, and this fails
 * loudly rather than picking one and being wrong for half of ENS.
 */

import {
	decodeAddress,
	decodeArray,
	decodeUint,
	encodeAddress,
	ethCallBatch,
	RpcError,
} from "./rpc";
import { HUB_CHAIN } from "./chains";

/**
 * ENS v2 on Sepolia — `docs/DEPLOYMENTS.md`.
 *
 * Two renewers, not one: `ETHRegistrar` prices migrated names and
 * `ETHRenewerV1` prices premigrated v1 reservations, and both populations
 * coexist during the migration. These are addresses, not prices — pinning them
 * is the same kind of constant as a contract address in `tokens.ts`, and the
 * helper stores them for exactly this reason.
 */
export const ETH_REGISTRAR = HUB_CHAIN.ensRegistrarAddress!;
export const ETH_RENEWER_V1 = HUB_CHAIN.ensRenewerV1Address!;

/** USDC on Sepolia, from the list the supported-tokens page publishes. */
const SEPOLIA_USDC = HUB_CHAIN.usdcAddress;

/** One of ENS's `DiscountPoint`s: buy at least `duration` and pay `numer/denom`. */
export interface DiscountPoint {
	duration: bigint;
	numer: bigint;
}

/** Everything `pricing.ts` needs, and nothing it doesn't. */
export interface OracleRates {
	/** The oracle these came from, for display and for verification. */
	oracle: string;
	/** `DISCOUNT_DENOMINATOR()` — `numer/denom` is the multiplier, so 1e38 = full price. */
	denom: bigint;
	/**
	 * `getBaseRates()`, per second. Indexed by **length − 1**, so a 3-character
	 * name is `baseRates[2]`; `rateFor` is the only thing that should index it.
	 */
	baseRates: bigint[];
	/** `getDiscountPoints()`, ascending by duration. */
	points: DiscountPoint[];
	/** `getPaymentTokenRatio(USDC)` — ENS charges `ceil(standard * numer / denom)`. */
	tokenNumer: bigint;
	tokenDenom: bigint;
	/** When this was read, so the UI can say how fresh it is. */
	readAt: number;
}

export class OracleConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OracleConfigError";
	}
}

/**
 * Read the live pricing configuration. Throws `RpcError` if the chain can't be
 * reached and `OracleConfigError` if what came back can't be priced with.
 *
 * Two round-trips, not one: the oracle address has to come back before its
 * getters can be called. Everything within a trip is batched.
 */
export async function loadOracleRates(): Promise<OracleRates> {
	const [registrarOracle, v1Oracle] = (
		await ethCallBatch([
			{ to: ETH_REGISTRAR, signature: "rentPriceOracle()" },
			{ to: ETH_RENEWER_V1, signature: "rentPriceOracle()" },
		])
	).map(decodeAddress);

	if (registrarOracle !== v1Oracle) {
		/* See the header. Two oracles means two price tables, and the UI shows
		   one — refuse rather than silently price half of ENS wrongly. */
		throw new OracleConfigError(
			`ENS's two renewers price with different oracles (${registrarOracle} and ${v1Oracle}).`,
		);
	}

	const oracle = registrarOracle;
	if (/^0x0+$/.test(oracle)) {
		throw new OracleConfigError("ENS's renewer reports no price oracle.");
	}

	const [rawDenom, rawRates, rawPoints, rawRatio] = await ethCallBatch([
		{ to: oracle, signature: "DISCOUNT_DENOMINATOR()" },
		{ to: oracle, signature: "getBaseRates()" },
		{ to: oracle, signature: "getDiscountPoints()" },
		{
			to: oracle,
			signature: "getPaymentTokenRatio(address)",
			args: [encodeAddress(SEPOLIA_USDC)],
		},
	]);

	const baseRates = decodeArray(rawRates).map((row) => row[0]);
	const points: DiscountPoint[] = decodeArray(rawPoints, 2).map(
		([duration, numer]) => ({ duration, numer }),
	);
	const denom = decodeUint(rawDenom);

	/* `(uint128, uint128)` is two plain words, not an array — `decodeArray`
	   would read the first as an offset. */
	const [tokenNumer, tokenDenom] = splitPair(rawRatio);

	const rates: OracleRates = {
		oracle,
		denom,
		baseRates,
		points,
		tokenNumer,
		tokenDenom,
		readAt: Date.now(),
	};

	validate(rates);
	return rates;
}

function splitPair(data: string): [bigint, bigint] {
	if (data.length !== 128) {
		throw new RpcError(`Expected two words from getPaymentTokenRatio, got ${data.length / 64}.`);
	}
	return [BigInt(`0x${data.slice(0, 64)}`), BigInt(`0x${data.slice(64)}`)];
}

/**
 * The same assertions the helper makes before it will price anything, for the
 * same reason: an oracle shaped in a way this code doesn't anticipate should
 * stop the app, not quietly mis-price it.
 *
 * `_validatePoints` in `contracts/ENSV2RenewalHelper.sol` is the original.
 */
function validate(r: OracleRates): void {
	if (r.tokenNumer === 0n || r.tokenDenom === 0n) {
		throw new OracleConfigError("ENS does not price this USDC contract.");
	}

	/* Indexed by length − 1, so a 3-character name — the shortest ENS prices —
	   needs three entries to exist at all. */
	if (r.baseRates.length < 3) {
		throw new OracleConfigError("ENS's base-rate table is too short to price a name.");
	}
	if (r.baseRates.every((x) => x === 0n)) {
		throw new OracleConfigError("ENS's base rates are all zero.");
	}

	if (r.points.length === 0) return;

	/* ENS leaves the denominator at zero when there are no discounts, so this
	   is only required once there are points to scale. */
	if (r.denom === 0n) {
		throw new OracleConfigError("ENS has discount tiers but no denominator.");
	}

	/* Durations must ascend and numerators descend, or "the first affordable
	   tier is the best tier" — which is how `solve` picks — stops being true. */
	for (let i = 1; i < r.points.length; i++) {
		const prev = r.points[i - 1];
		const cur = r.points[i];
		if (cur.duration <= prev.duration || cur.numer >= prev.numer) {
			throw new OracleConfigError(
				"ENS's discount tiers are not ordered longest-cheapest.",
			);
		}
	}
	if (r.points.some((p) => p.numer === 0n || p.numer > r.denom)) {
		throw new OracleConfigError("ENS has a discount tier outside 0–100%.");
	}
}
