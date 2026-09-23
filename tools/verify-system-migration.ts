/** Read-only preflight. Run with ETHEREUM_SEPOLIA_RPC_URL set. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, parseAbi, type Hex } from "viem";
import { HUB_CHAIN } from "../src/lib/chains";
import { depositAddress } from "../src/lib/namepass";
import { assertEnsV2Adapter } from "../src/lib/helperAdapter";
import { readEnsState } from "../server/chain";
import { indexedRenewalExpiry } from "../server/indexed-renewal";
import { parseGoldskyEvent } from "../server/goldsky";

const url = process.env[HUB_CHAIN.rpcEnv];
if (!url) throw new Error(`${HUB_CHAIN.rpcEnv} is required.`);
const client = createPublicClient({ transport: http(url) });
assert.equal(await client.getChainId(), HUB_CHAIN.chainId);
assert.equal(depositAddress("steve"), "0x5B7516768eD0b04E212041265BB1f11af71841d7");
assert.equal(depositAddress("vitalik"), "0xa61656CA2D2952a46a9d4DA0AAE01d8D7fe988E0");
const helper = await client.readContract({ address: HUB_CHAIN.pointerAddress as Hex, abi: parseAbi(["function currentHelper() view returns (address)"]), functionName: "currentHelper" });
assertEnsV2Adapter(await client.getCode({ address: helper }));
const states = await Promise.all(["steve", "vitalik"].map(async label => ({ label, ...await readEnsState(label) })));
const report = { checkedAt: new Date().toISOString(), helper, states, addressDerivation: "passed", adapterFingerprint: "passed" };
try {
const rehearsal = JSON.parse(readFileSync(new URL("../docs/deployments/2026-09-22/canaries.json", import.meta.url), "utf8"));
const hash = rehearsal.records.find((r: { action: string }) => r.action === "claim").hash as Hex;
const receipt = await client.getTransactionReceipt({ hash });
const abi = parseAbi(["event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)"]);
const log = receipt.logs.find(log => {
 try { return log.address.toLowerCase() === HUB_CHAIN.gatewayAddress!.toLowerCase() && decodeEventLog({ abi, ...log }).eventName === "Renewed"; } catch { return false; }
})!;
const { args } = decodeEventLog({ abi, ...log });
const event = parseGoldskyEvent({
 event_id: `11155111:${hash}:${log.logIndex}`, event_family: "namepass", event_type: "Renewed",
 chain_id: HUB_CHAIN.chainId, block_number: Number(receipt.blockNumber), block_time: 1_789_800_000,
 tx_hash: hash, log_index: log.logIndex, _gs_op: "c", contract_address: log.address,
 label_hash: args.labelHash, wallet_address: args.wallet, executor_address: args.executor,
 label: args.label, duration: String(args.duration), amount_received: String(args.amountReceived),
 gas_allowance: String(args.gasAllowance), amount_applied: String(args.amountApplied), remainder: String(args.remainder), from_cctp: String(args.fromCCTP),
});
const expiry = await indexedRenewalExpiry(event);
console.log(JSON.stringify({ ...report, replacementClaim: hash, expiry, indexedReceipt: "passed" }, null, 2));
} catch (error) {
 console.log(JSON.stringify({ ...report, indexedReceipt: "blocked", error: (error as Error).message }, null, 2));
 process.exitCode = 1;
}

