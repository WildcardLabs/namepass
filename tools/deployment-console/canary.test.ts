import assert from "node:assert/strict";
import test from "node:test";
import { concat, padHex, stringToHex, toHex, zeroAddress, zeroHash, type Hex } from "viem";
import { buildPlan, hub, network, predictWallet } from "./model";
import { assertAttestedSource, TEST_AMOUNT, validateMessage } from "./canary";
const plan = buildPlan({ owner: "0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6", residueRecipient: "0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6", saltLabel: "canary-validation", referrer: zeroHash, delay: 60 });
const source = network(84532), gateway = plan.deployments.NamepassL1Gateway.address;
function message(final: boolean): Hex {
  return concat([toHex(1,{size:4}),toHex(source.circleDomain!,{size:4}),toHex(0,{size:4}),final ? toHex(123n,{size:32}) : zeroHash,padHex(source.tokenMessengerAddress as Hex,{size:32}),padHex(hub.tokenMessengerAddress as Hex,{size:32}),padHex(gateway,{size:32}),toHex(2000,{size:4}),toHex(final ? 2000 : 0,{size:4}),toHex(1,{size:4}),padHex(source.usdcAddress as Hex,{size:32}),padHex(gateway,{size:32}),toHex(TEST_AMOUNT,{size:32}),padHex(predictWallet(plan,"steve"),{size:32}),zeroHash,zeroHash,zeroHash,stringToHex("steve")]);
}
function replace(raw: Hex, offset: number, value: Hex): Hex { return `${raw.slice(0,2+offset*2)}${value.slice(2)}${raw.slice(2+offset*2+value.length-2)}` as Hex; }
test("canary CCTP validator binds both routes, exact amount, label, wallet, and finality", () => {
  const raw=message(true);
  assert.equal(validateMessage(plan,84532,"steve",raw,true).amount,TEST_AMOUNT);
  assert.throws(()=>validateMessage(plan,84532,"vitalik",raw,true));
  assert.throws(()=>validateMessage(plan,421614,"steve",raw,true));
  for(const [offset,value] of [[12,zeroHash],[108,padHex(zeroAddress,{size:32})],[184,padHex(zeroAddress,{size:32})],[216,toHex(2_000_000n,{size:32})],[248,padHex(zeroAddress,{size:32})],[312,toHex(1n,{size:32})],[144,toHex(1000,{size:4})]] as const) assert.throws(()=>validateMessage(plan,84532,"steve",replace(raw,offset,value),true));
});
test("attestation preserves the origin message except Circle-assigned fields", () => {
  assertAttestedSource(message(false),message(true));
  for(const [offset,value] of [[4,toHex(3,{size:4})],[152,padHex(zeroAddress,{size:32})],[216,toHex(2n,{size:32})],[280,toHex(1n,{size:32})],[376,stringToHex("other")]] as const) assert.throws(()=>assertAttestedSource(message(false),replace(message(true),offset,value)));
});

test("Arc native receipt verification checks the token balance and deployed-wallet round", async () => {
  const { verifyCanaryReceipt } = await import("./canary");
  const wallet = predictWallet(plan, "steve");
  const hash = `0x${"11".repeat(32)}` as Hex;
  let code: Hex = "0x363d3d";
  let after = TEST_AMOUNT;
  const client = {
    getTransactionReceipt: async () => ({ status: "success", blockNumber: 2n, blockHash: hash, logs: [] }),
    getTransaction: async () => ({ from: plan.config.owner, to: wallet, input: "0x", value: 10n ** 18n }),
    getBlock: async () => ({ hash }),
    readContract: async ({ blockNumber }: { blockNumber: bigint }) => blockNumber === 1n ? 0n : after,
    getCode: async () => code,
  };
  const record = { label: "steve", origin: 5042002, round: 2, action: "fund" as const, hash, status: "pending" as const, tx: { chainId: 5042002, to: wallet, data: "0x" as Hex } };
  const reader = () => client as any;
  assert.equal((await verifyCanaryReceipt(plan, record, reader)).status, "verified");
  after = 0n;
  await assert.rejects(verifyCanaryReceipt(plan, record, reader), /balance/);
  after = TEST_AMOUNT; code = "0x";
  await assert.rejects(verifyCanaryReceipt(plan, record, reader), /deployment state/);
  assert.equal((await verifyCanaryReceipt(plan, { ...record, round: 1 }, reader)).status, "verified");
});
