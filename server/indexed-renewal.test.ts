import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, type TransactionReceipt } from "viem";
import { indexedRenewalSegment } from "./indexed-renewal";
import { HUB_CHAIN } from "../src/lib/chains";
import type { GoldskyEvent } from "./goldsky";

const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"1".repeat(64)}` as const;
const abi = parseAbi(["event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)"]);
const data = encodeAbiParameters(parseAbiParameters("string,uint64,uint256,uint256,uint256,uint256,bool"), ["steve", 100n, 1000000n, 100000n, 900000n, 0n, false]);
const topics = encodeEventTopics({ abi, eventName: "Renewed", args: { labelHash: hash, wallet: address, executor: address } });
const log = (logIndex: number) => ({ address: HUB_CHAIN.gatewayAddress!, logIndex, data, topics });
const receipt = { logs: [log(2), { ...log(3), address }, log(5)] } as unknown as Pick<TransactionReceipt, "logs">;
const event = { logIndex: 5, facts: {
 label_hash: hash, wallet_address: address, executor_address: address, label: "steve", duration: "100",
 amount_received: "1000000", gas_allowance: "100000", amount_applied: "900000", remainder: "0", from_cctp: "false",
} } as unknown as GoldskyEvent;

test("equal renewals in one transaction have separate receipt segments", () => {
 assert.deepEqual(indexedRenewalSegment(receipt, event).map(log => log.logIndex), [3, 5]);
});
test("index enrichment rejects mismatched facts and a forged gateway event", () => {
 assert.throws(() => indexedRenewalSegment(receipt, { ...event, facts: { ...event.facts, amount_applied: "1" } }), /amount_applied/);
 assert.throws(() => indexedRenewalSegment(receipt, { ...event, logIndex: 3 }), /missing/);
});
