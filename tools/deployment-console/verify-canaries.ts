import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, type Hex, type PublicClient } from "viem";
import { assertAttestedSource, LABELS, TEST_AMOUNT, originEvidence, verifyCanaryReceipt, type CanaryRecord } from "./canary";
import { buildPlan, bundle, HUB, network, networks, predictWallet } from "./model";
import { json, parseSession } from "./storage";

const [deploymentPath, evidencePath, outputPath] = process.argv.slice(2);
assert(deploymentPath && evidencePath && outputPath, "Usage: verify-canaries.ts DEPLOYMENT CANARIES REPORT");
const plan = buildPlan(parseSession(readFileSync(deploymentPath, "utf8")).config);
const input = JSON.parse(readFileSync(evidencePath, "utf8"));
assert.equal(input.fingerprint, plan.fingerprint);
assert(Array.isArray(input.records));
const records = input.records as CanaryRecord[];
const urls: Record<number, string> = { 11155111: "https://ethereum-sepolia-rpc.publicnode.com", 84532: "https://sepolia.base.org", 421614: "https://sepolia-rollup.arbitrum.io/rpc", 5042002: "https://rpc.testnet.arc.network" };
const clients = new Map(networks.map(n => [n.chainId, createPublicClient({ transport: http(urls[n.chainId]) }) as PublicClient]));
const reader = (id: number) => { const client = clients.get(id); assert(client); return client; };
const seen = new Set<string>();
for (const record of records) {
  assert(LABELS.includes(record.label as typeof LABELS[number]));
  network(record.origin);
  assert(["fund", "renew", "claim"].includes(record.action));
  assert(/^0x[0-9a-f]{64}$/i.test(record.hash));
  assert(!seen.has(record.hash), "Duplicate transaction hash"); seen.add(record.hash);
  assert.equal(record.tx.chainId, record.action === "claim" ? HUB : record.origin);
  if (record.action === "fund" && record.origin === 5042002) {
    assert.equal(record.tx.to.toLowerCase(), predictWallet(plan, record.label).toLowerCase());
    assert.equal(record.tx.data, "0x");
  } else if (record.action === "fund") {
    assert.equal(record.tx.to.toLowerCase(), network(record.origin).usdcAddress.toLowerCase());
    assert.equal(record.tx.data, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [predictWallet(plan, record.label), TEST_AMOUNT] }));
  } else if (record.action === "renew") {
    assert.equal(record.tx.to.toLowerCase(), plan.deployments.NamepassFactory.address.toLowerCase());
    assert.equal(record.tx.data, encodeFunctionData({ abi: bundle.contracts.NamepassFactory.abi, functionName: "renew", args: [record.label] }));
  } else {
    assert.notEqual(record.origin, HUB);
    assert.equal(record.tx.to.toLowerCase(), plan.deployments.NamepassL1Gateway.address.toLowerCase());
  }
}
const result = await Promise.allSettled(networks.map(async n => {
  assert.equal(await reader(n.chainId).getChainId(), n.chainId);
  const checked = [];
  for (const record of records.filter(r => r.tx.chainId === n.chainId)) {
    const verified = await verifyCanaryReceipt(plan, record, reader);
    assert.equal(verified.status, "verified");
    if (record.action === "claim") {
      const burns = records.filter(r => r.label === record.label && r.origin === record.origin && r.action === "renew" && (r.round ?? 1) === (record.round ?? 1));
      assert.equal(burns.length, 1, "Claim requires one source burn");
      const sourceReceipt = await reader(record.origin).getTransactionReceipt({ hash: burns[0].hash });
      const source = originEvidence(plan, record.origin, record.label, sourceReceipt);
      const decoded = decodeFunctionData({ abi: bundle.contracts.NamepassL1Gateway.abi, data: record.tx.data });
      assertAttestedSource(source.message, decoded.args![0] as Hex);
    }
    checked.push({ label: record.label, origin: record.origin, action: record.action, round: record.round ?? 1, hash: record.hash, ...verified });
    console.log(`${record.label} ${record.origin} ${record.action}: verified`);
  }
  return checked;
}));
const checked = result.flatMap(r => r.status === "fulfilled" ? r.value : []);
const coverage = [];
for (const [label, chainId, round] of [["steve", HUB, 1], ["steve", 5042002, 1], ["steve", 5042002, 2]] as const) {
  const steps = chainId === HUB ? ["fund", "renew"] : ["fund", "renew", "claim"];
  const missing = steps.filter(action => !checked.some(r => r.label === label && r.origin === chainId && r.round === round && r.action === action));
  coverage.push({ label, chainId, round, complete: missing.length === 0, missing, depositAddress: predictWallet(plan, label) });
}
const report = { checkedAt: new Date().toISOString(), fingerprint: plan.fingerprint, status: result.every(r => r.status === "fulfilled") ? "receipts_verified" : "errors", errors: result.flatMap(r => r.status === "rejected" ? [String(r.reason)] : []), coverage, records: checked };
writeFileSync(outputPath, `${json(report)}\n`);
console.log(json({ status: report.status, errors: report.errors, coverage }));
assert.equal(report.errors.length, 0);

assert(coverage.every(c => c.complete), "Required reduced canary coverage missing");
