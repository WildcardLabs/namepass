import { parseAbi, toFunctionSelector, type Address } from "viem";
import { HUB_CHAIN } from "../../src/lib/chains";
import { discoverHelper } from "../../src/lib/helperDiscovery";
import { assertEnsV2Adapter } from "../../src/lib/helperAdapter";
import { normalizedLabel } from "../names";
import { ApiError, json, readObject, requiredString } from "../http";
import { minimumTriggerAmount } from "../config";
import { evidenceClient } from "./rpc";
import { chain, unsigned } from "./validation";

/** Read the same helper algorithm mirrored by the frontend, at one exact block. */
export async function quoteResponse(request: Request) {
	const body = await readObject(request, ["name", "chainId", "amount"]);
	const name = normalizedLabel(requiredString(body, "name", 512));
	const source = chain(body.chainId);
	const amount = BigInt(unsigned(body.amount, "amount", true));
	if (amount < minimumTriggerAmount(source.chainId))
		throw new ApiError(
			422,
			"amount_below_minimum",
			"The amount is below the current renewal minimum.",
		);
	try {
		// One quote is one processing flow. Above Circle's cap, each slice incurs its own allowance.
		if (source.chainId !== HUB_CHAIN.chainId) {
			const client = await evidenceClient(source),
				blockNumber = await client.getBlockNumber();
			const minter = await client.readContract({
				address: source.tokenMessengerAddress as Address,
				abi: parseAbi(["function localMinter() view returns(address)"]),
				functionName: "localMinter",
				blockNumber,
			});
			// Circle's route API also supports deployed V2 versions without getMinFeeAmount.
			// Missing or malformed fee evidence is unavailable, never an assumed zero fee.
			const iris = new URL(process.env.CIRCLE_IRIS_URL ?? "");
			if (iris.protocol !== "https:" || iris.username || iris.password)
				throw new Error("Invalid Circle endpoint.");
			const response = await fetch(
				new URL(
					`/v2/burn/USDC/fees/${source.circleDomain}/${HUB_CHAIN.circleDomain}`,
					iris,
				),
				{
					headers: { accept: "application/json" },
					signal: AbortSignal.timeout(8000),
				},
			);
			if (!response.ok) throw new Error("Circle fees unavailable.");
			const fees: unknown = await response.json();
			if (!Array.isArray(fees)) throw new Error("Invalid Circle fees.");
			const standard = fees.filter(
				(entry) =>
					entry !== null &&
					typeof entry === "object" &&
					entry.finalityThreshold === 2000,
			);
			if (
				standard.length !== 1 ||
				typeof standard[0].minimumFee !== "number" ||
				!Number.isFinite(standard[0].minimumFee) ||
				standard[0].minimumFee < 0
			)
				throw new Error("Invalid standard route fee.");
			if (standard[0].minimumFee !== 0)
				throw new ApiError(
					503,
					"standard_route_unavailable",
					"This route currently requires a Circle fee that automatic processing does not authorize.",
				);

			const maximum = await client.readContract({
				address: minter,
				abi: parseAbi([
					"function burnLimitsPerMessage(address) view returns(uint256)",
				]),
				functionName: "burnLimitsPerMessage",
				args: [source.usdcAddress as Address],
				blockNumber,
			});
			if (maximum === 0n)
				throw new ApiError(
					503,
					"burns_unavailable",
					"This funding route is temporarily unavailable.",
				);
			if (amount > maximum)
				throw new ApiError(
					422,
					"amount_above_quote_limit",
					"The amount requires multiple processing flows. Quote an amount within the route limit.",
					{ maximumAmount: maximum.toString() },
				);
		}
		const client = await evidenceClient(HUB_CHAIN),
			block = await client.getBlock();
		const helper = await discoverHelper(async (calls) =>
			Promise.all(
				calls.map(async (call) => {
					const result = await client.call({
						to: call.to as Address,
						data: toFunctionSelector(call.signature),
						blockNumber: block.number,
					});
					if (!result.data) throw new Error("Missing helper response.");
					return result.data.slice(2);
				}),
			),
		);
		assertEnsV2Adapter(
			await client.getCode({
				address: helper as Address,
				blockNumber: block.number,
			}),
		);
		const allowance = await client.readContract({
			address: HUB_CHAIN.gatewayAddress as Address,
			abi: parseAbi(["function GAS_ALLOWANCE() view returns(uint256)"]),
			functionName: "GAS_ALLOWANCE",
			blockNumber: block.number,
		});
		if (amount <= allowance)
			throw new ApiError(
				422,
				"amount_below_minimum",
				"The amount does not cover the renewal allowance.",
			);
		const renewer = await client.readContract({
			address: helper as Address,
			abi: parseAbi([
				"function renewableBy(string label) view returns(address)",
			]),
			functionName: "renewableBy",
			args: [name],
			blockNumber: block.number,
		});
		if (/^0x0+$/.test(renewer))
			throw new ApiError(
				422,
				"name_not_renewable",
				"This name cannot currently be renewed.",
			);
		const [seconds, needed] = await client.readContract({
			address: helper as Address,
			abi: parseAbi([
				"function quote(string label,uint256 budget) view returns(uint64 duration,uint256 amountNeeded)",
			]),
			functionName: "quote",
			args: [name, amount - allowance],
			blockNumber: block.number,
		});
		if (seconds === 0n || needed > amount - allowance)
			throw new Error("Invalid helper quote.");
		return json({
			name: `${name}.eth`,
			chainId: String(source.chainId),
			amount: amount.toString(),
			secondsAdded: seconds.toString(),
			amountApplied: needed.toString(),
			renewalFee: allowance.toString(),
			bridgeFee: "0",
			roundingRemainder: (amount - allowance - needed).toString(),
			pricingBlock: block.number.toString(),
			expiresAt: new Date(Date.now() + 60000).toISOString(),
			estimate: true,
		});
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError(
			503,
			"pricing_unavailable",
			"Verified pricing is temporarily unavailable. Try again shortly.",
		);
	}
}
