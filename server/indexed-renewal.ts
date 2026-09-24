import { createPublicClient, decodeEventLog, getAddress, http, parseAbi, type Hex, type TransactionReceipt } from "viem";
import { HUB_CHAIN } from "../src/lib/chains";
import { readReceiptEnsExpiry } from "./ens-renewal";
import type { GoldskyEvent } from "./goldsky";

const ABI = parseAbi(["event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)"]);

/** Enrich only a canonical gateway renewal. No independent ENS address allowlist is needed. */
export async function indexedRenewalExpiry(event: GoldskyEvent): Promise<string> {
	const url = process.env[HUB_CHAIN.rpcEnv];
	if (!url) throw new Error(`${HUB_CHAIN.rpcEnv} is not configured.`);
	const client = createPublicClient({ transport: http(url) });
	if (await client.getChainId() !== HUB_CHAIN.chainId) throw new Error("The indexer RPC serves the wrong chain.");
	const receipt = await client.getTransactionReceipt({ hash: event.txHash as Hex });
	if (receipt.status !== "success" || receipt.blockNumber !== BigInt(event.blockNumber)) throw new Error("The indexed renewal receipt does not match its block.");
	const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
	if (canonical.hash !== receipt.blockHash) throw new Error("The indexed renewal receipt is not canonical.");
	const segment = indexedRenewalSegment(receipt, event);
	const expiry = await readReceiptEnsExpiry(segment, String(event.facts.label), receipt.blockNumber);
	return String(expiry.getTime() / 1000);
}

export function indexedRenewalSegment(receipt: Pick<TransactionReceipt, "logs">, event: GoldskyEvent) {
	const renewals = receipt.logs.flatMap(log => {
		if (getAddress(log.address) !== getAddress(HUB_CHAIN.gatewayAddress!)) return [];
		try { return [{ log, args: decodeEventLog({ abi: ABI, ...log, strict: true }).args }]; }
		catch { return []; }
	});
	const at = renewals.findIndex(row => row.log.logIndex === event.logIndex);
	if (at < 0) throw new Error("The indexed gateway renewal is missing from its receipt.");
	const args = renewals[at].args;
	const facts = {
		label_hash: args.labelHash, wallet_address: args.wallet, executor_address: args.executor,
		label: args.label, duration: args.duration, amount_received: args.amountReceived,
		gas_allowance: args.gasAllowance, amount_applied: args.amountApplied,
		remainder: args.remainder, from_cctp: args.fromCCTP,
	};
	for (const [key, value] of Object.entries(facts)) {
		const actual = String(value), indexed = String(event.facts[key]);
		if (key === "label" ? actual !== indexed : actual.toLowerCase() !== indexed.toLowerCase()) {
			throw new Error(`The indexed renewal does not match receipt field ${key}.`);
		}
	}
	const previous = at === 0 ? -1 : renewals[at - 1].log.logIndex;
	const segment = receipt.logs.filter(log => log.logIndex > previous && log.logIndex <= event.logIndex);
	return segment;
}
