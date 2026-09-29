import { toFunctionSelector, parseAbi, type Address } from "viem";
import { HUB_CHAIN } from "../../src/lib/chains";
import { discoverHelper } from "../../src/lib/helperDiscovery";
import { assertEnsV2Adapter } from "../../src/lib/helperAdapter";
import { evidenceClient } from "./rpc";
import { ApiError } from "../http";
import { minimumTriggerAmount } from "../config";
import { DEPLOYMENT_ID } from "./config";
import type { Context } from "./http";
import * as validate from "./validation";

/** All contract reads share one block; no module-level mutable pricing cache. */
export async function quote(context: Context) {
	validate.fields(context.body, ["name", "chainId", "amount"]);
	const name = validate.name(context.body.name),
		chain = validate.chain(context.body.chainId),
		amount = BigInt(validate.unsigned(context.body.amount, "amount", true));
	const client = await evidenceClient(HUB_CHAIN),
		block = await client.getBlock();
	const helper = await discoverHelper(async (calls) =>
		Promise.all(
			calls.map(async (call) => {
				const data = toFunctionSelector(call.signature);
				const result = await client.call({
					to: call.to as Address,
					data,
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
	if (amount < minimumTriggerAmount(chain.chainId) || amount <= allowance)
		throw new ApiError(
			422,
			"amount_below_minimum",
			"The amount is below the current renewal minimum.",
		);
	const [duration, needed] = await client.readContract({
		address: helper as Address,
		abi: parseAbi([
			"function quote(string label,uint256 budget) view returns(uint64 duration,uint256 amountNeeded)",
		]),
		functionName: "quote",
		args: [name, amount - allowance],
		blockNumber: block.number,
	});
	return {
		body: {
			name: `${name}.eth`,
			chainId: String(chain.chainId),
			deploymentId: DEPLOYMENT_ID,
			amount: amount.toString(),
			executorAllowance: allowance.toString(),
			bridgeFee: "0",
			amountApplied: needed.toString(),
			roundingResidue: (amount - allowance - needed).toString(),
			durationSeconds: duration.toString(),
			helperAddress: helper,
			blockNumber: block.number.toString(),
			blockHash: block.hash,
			expiresAt: new Date(Date.now() + 60000).toISOString(),
			estimate: true,
			assumptions: [
				"standard_cctp",
				"single_flow",
				"unchanged_pricing",
				"no_existing_wallet_balance",
			],
		},
	};
}
