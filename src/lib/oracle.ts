/** ENS pricing follows the pointer-selected helper at one block. */

import {
	configurationBlock,
	SEPOLIA_RPC,
	decodeAddress,
	decodeArray,
	decodeUint,
	encodeAddress,
	ethCallBatch,
	RpcError,
} from "./rpc";
import { createPublicClient, http, type Address } from "viem";
import { assertEnsV2Adapter } from "./helperAdapter";
import { HUB_CHAIN } from "./chains";

import { discoverHelper, readEnsV2Metadata } from "./helperDiscovery";

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
	const block = await configurationBlock();
	const read = (calls: import("./rpc").Call[]) => ethCallBatch(calls, undefined, block);
	const helper = await discoverHelper(read);
	assertEnsV2Adapter(await createPublicClient({ transport: http(SEPOLIA_RPC) }).getCode({ address: helper as Address, blockNumber: BigInt(block) }));
	const metadata = await readEnsV2Metadata(read, helper);
	const [registrarOracle, v1Oracle] = (
		await read([
			{ to: metadata.registrar, signature: "rentPriceOracle()" },
			{ to: metadata.renewerV1, signature: "rentPriceOracle()" },
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

	const [rawDenom, rawRates, rawPoints, rawRatio] = await read([
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
