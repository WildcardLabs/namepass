import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256 } from "viem";
import { buildPlan, inspectStep, networks, predictWallet } from "./model";
import { json, parseSession } from "./storage";

// Read-only verification. This command never connects a signer.
const [input, output, previousManifest] = process.argv.slice(2);
assert(input && output, "Usage: tsx tools/deployment-console/verify.ts MANIFEST REPORT");
const raw = JSON.parse(readFileSync(input, "utf8"));
const session = parseSession(JSON.stringify(raw));
const plan = buildPlan(session.config);
const previous = previousManifest ? JSON.parse(readFileSync(previousManifest, "utf8")) : undefined;
for (const deployment of Object.values(plan.deployments)) {
  const saved = raw.contracts[deployment.name];
  assert.equal(saved.address, deployment.address);
  assert.equal(saved.creationCodeHash, keccak256(deployment.initcode));
  assert.equal(saved.runtimeCodeHash, keccak256(deployment.runtime));
  assert.equal(saved.constructorArgs, deployment.constructorArgs);
  assert.equal(saved.salt, deployment.salt);
}
assert.equal(raw.activation.operationId, plan.operationId);
assert.equal(raw.activation.calldata, plan.updateData);
const rpc: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532: "https://sepolia.base.org",
  421614: "https://sepolia-rollup.arbitrum.io/rpc",
  5042002: "https://rpc.testnet.arc.network",
};
const results = await Promise.allSettled(networks.map(async network => {
  const client = createPublicClient({ transport: http(rpc[network.chainId]) });
  assert.equal(await client.getChainId(), network.chainId);
  const start = await client.getBlockNumber({ cacheTime: 0 });
  const steps = [];
  for (const step of plan.steps.filter(step => step.chainId === network.chainId)) {
    const reused = !session.journal[step.id];
    const entry = session.journal[step.id] ?? (step.kind === "deploy" ? previous?.journal?.[step.id] : undefined);
    assert(entry, `Missing transaction: ${step.id}`);
    assert.equal(entry.chainId, step.chainId);
    assert.equal(entry.dataHash, keccak256(step.data));
    if (reused) {
      const state = await inspectStep(client, plan, step);
      assert.equal(state.state, "complete", `${step.id}: ${state.detail}`);
      steps.push({ id: step.id, reused: true, originalHash: entry.hash, receiptRechecked: false, ...state });
      console.log(`${network.chainId}: ${step.id} current runtime and configuration verified (reused)`);
      continue;
    }
    const [tx, receipt, state] = await Promise.all([
      client.getTransaction({ hash: entry.hash }),
      client.getTransactionReceipt({ hash: entry.hash }),
      inspectStep(client, plan, step),
    ]);
    assert.equal(tx.from.toLowerCase(), plan.config.owner.toLowerCase());
    assert.equal(tx.to?.toLowerCase(), step.to.toLowerCase());
    assert.equal(tx.input.toLowerCase(), step.data.toLowerCase());
    assert.equal(tx.value, 0n);
    assert.equal(receipt.status, "success");
    assert.equal(receipt.blockNumber.toString(), entry.blockNumber);
    assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
    assert.equal(state.state, "complete", `${step.id}: ${state.detail}`);
    steps.push({ id: step.id, reused, hash: entry.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, ...state });
    console.log(`${network.chainId}: ${step.id} verified`);
  }
  return { chainId: network.chainId, observationStartBlock: start, observationEndBlock: await client.getBlockNumber({ cacheTime: 0 }), steps };
}));
const failures = results.filter(result => result.status === "rejected");
const report = {
  checkedAt: new Date().toISOString(), fingerprint: plan.fingerprint,
  status: failures.length ? "failed" : "passed", contracts: raw.contracts,
  config: plan.config, sampleWallet: { label: "vitalik", address: predictWallet(plan, "vitalik") },
  chains: results.map((result, i) => result.status === "fulfilled" ? result.value : { chainId: networks[i].chainId, error: String(result.reason) }),
  scope: "Read-only runtime, configuration, canonical receipts for new transactions, transaction inputs, activation, and wallet derivation. Reused deployments verify current runtime and configuration; their original receipts are not rechecked. Does not prove explorer source verification or live renewal/CCTP canaries.",
};
writeFileSync(output, `${json(report)}\n`);
assert.equal(failures.length, 0, json(report.chains));
console.log(`Saved ${output}`);
