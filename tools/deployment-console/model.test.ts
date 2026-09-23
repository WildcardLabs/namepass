import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createPublicClient, createWalletClient, decodeFunctionData, http, keccak256, zeroAddress, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildPlan, bundle, HUB, inspectStep, networks, preflight, predictWallet, SINGLETON, SINGLETON_RUNTIME, verifyDeployment, type Config } from "./model";
import { json, manifest, newSession, parseSession } from "./storage";
import { buildUpgrade, checkUpgrade, prepareUpgrade, staticUpgradeTx, verifyUpgradeRecord, type UpgradeRecord } from "./upgrade";
import { sendStep, type WalletProvider } from "./wallet";

const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const config: Config = { owner: account.address, residueRecipient: account.address, referrer: `0x${"12".repeat(32)}`, saltLabel: "namepass-console-integration-v1", delay: 300 };

test("one deterministic factory, no existing deployment salt, and bounded transaction targets", () => {
  const plan = buildPlan(config);
  assert.equal(plan.steps.length, 14);
  const deployments = plan.steps.filter(s => s.deployment?.name === "NamepassFactory");
  assert.equal(deployments.length, 4);
  assert.equal(new Set(deployments.map(s => s.deployment!.address)).size, 1);
  for (const step of plan.steps) {
    assert(networks.some(n => n.chainId === step.chainId));
    if (step.kind === "deploy") assert.equal(step.to, SINGLETON);
  }
  assert.throws(() => buildPlan({ ...config, saltLabel: "namepass" }));
  assert.throws(() => buildPlan({ ...config, delay: 0 }));
  assert.throws(() => buildPlan({ ...config, owner: zeroAddress }));
  assert.throws(() => buildPlan({ ...config, referrer: "0x00" }));
  assert.notEqual(buildPlan({ ...config, saltLabel: "different" }).deployments.NamepassFactory.address, plan.deployments.NamepassFactory.address);
  const schedule = decodeFunctionData({ abi: bundle.contracts.TimelockController.abi, data: plan.steps.find(s => s.kind === "schedule")!.data });
  assert.equal(schedule.functionName, "schedule");
  assert.equal(schedule.args?.[0], plan.deployments.RenewalHelperPointer.address);
  assert.equal(schedule.args?.[2], plan.updateData);
  assert.equal(schedule.args?.[5], 300n);
});

test("import reconstructs the plan and rejects stale or altered transaction records", () => {
  const session = newSession(config), plan = buildPlan(config);
  const exported = json(manifest(session, plan, {}));
  assert.deepEqual(parseSession(exported), session);
  assert.throws(() => parseSession(json({ ...session, artifactFingerprint: "0xbad" })));
  assert.throws(() => parseSession(json({ ...session, config: { ...config, delay: 60 } })));
  assert.throws(() => parseSession(json({ ...session, journal: { bad: { hash: `0x${"a".repeat(64)}` } } })));
  const entry = { hash: `0x${"a".repeat(64)}`, dataHash: keccak256(plan.steps[0].data), chainId: HUB, status: "submitted", submittedAt: new Date().toISOString() };
  assert.equal(Object.keys(parseSession(json({ ...session, journal: { [plan.steps[0].id]: entry } })).journal).length, 1);
  assert.throws(() => parseSession(json({ ...session, journal: { [plan.steps[0].id]: { ...entry, chainId: 1 } } })));
});

test("wallet account or network changes stop signing", async () => {
  const plan = buildPlan(config);
  let calls = 0;
  const provider = (owner: Address, chainId: string) => ({ request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [owner];
    if (method === "eth_chainId") return chainId;
    calls++; throw new Error("Signing must not be requested");
  } }) as unknown as WalletProvider;
  await assert.rejects(sendStep(provider(zeroAddress, "0xaa36a7"), plan, plan.steps[0]), /deployment wallet/);
  await assert.rejects(sendStep(provider(account.address, "0x1"), plan, plan.steps[0]), /network changed/);
  assert.equal(calls, 0);
});

test("explorer Standard JSON reproduces the exact deployment creation bytecode", { timeout: 90_000 }, () => {
  const compiler = process.env.NAMEPASS_SOLC ?? [
    `${homedir()}/.svm/0.8.24/solc-0.8.24`,
    `${homedir()}/Library/Application Support/svm/0.8.24/solc-0.8.24`,
  ].find(existsSync);
  assert(existsSync(compiler), "Set NAMEPASS_SOLC to the pinned local 0.8.24 compiler.");
  for (const [name, artifact] of Object.entries(bundle.contracts)) {
    const result = JSON.parse(execFileSync(compiler, ["--standard-json"], { input: JSON.stringify(artifact.standardInput), maxBuffer: 15_000_000 }).toString());
    assert.deepEqual((result.errors ?? []).filter((e: { severity: string }) => e.severity === "error"), []);
    assert.equal(`0x${result.contracts[artifact.source][name].evm.bytecode.object}`, artifact.bytecode, name);
  }
});

test("all 14 browser transactions execute on four local chains, resume safely, and bind the correct runtime", { timeout: 120_000 }, async () => {
  const processes: ReturnType<typeof spawn>[] = [];
  const clients = new Map<number, PublicClient>();
  const urls = new Map<number, string>();
  try {
    for (const [i, network] of networks.entries()) {
      const port = 18545 + i;
      const child = spawn("anvil", ["--port", String(port), "--chain-id", String(network.chainId), "--silent"], { stdio: "ignore" });
      processes.push(child);
      const url = `http://127.0.0.1:${port}`;
      urls.set(network.chainId, url);
      const client = createPublicClient({ transport: http(url, { retryCount: 0 }), pollingInterval: 20 });
      clients.set(network.chainId, client);
      let ready = false;
      for (let j = 0; j < 60; j++) {
        if (child.exitCode !== null) throw new Error(`Anvil exited on port ${port}.`);
        try { if (await client.getChainId() === network.chainId) { ready = true; break; } } catch { /* Local process is still starting. */ }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(ready, "Local Anvil did not start");
      async function setCode(address: Address, code = "0x00") {
        await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setCode", params: [address, code] }) }).then(r => r.json());
      }
      await setCode(SINGLETON, SINGLETON_RUNTIME);
      for (const address of [network.usdcAddress, network.tokenMessengerAddress, network.messageTransmitterAddress, "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca", "0xd06e726e9bd8ac0f33a2a45f4cc28fe10d656a36"]) {
        if (address) await setCode(address as Address);
      }
    }
    const plan = buildPlan(config);
    const reader = (id: number) => clients.get(id)!;
    for (const step of plan.steps) {
      if (step.kind === "activate") {
        const state = await inspectStep(reader(HUB), plan, step);
        assert.equal(state.state, "waiting");
        await assert.rejects(preflight(plan, step, reader), /delay/);
        await fetch(urls.get(HUB)!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [301] }) });
        await fetch(urls.get(HUB)!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });
      }
      const gas = await preflight(plan, step, reader);
      assert(gas > 0n);
      const wallet = createWalletClient({ account, chain: undefined, transport: http(urls.get(step.chainId)!) });
      const hash = await wallet.sendTransaction({ to: step.to, data: step.data, value: 0n, gas: gas * 12n / 10n });
      const receipt = await reader(step.chainId).waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", step.id);
      assert.equal((await inspectStep(reader(step.chainId), plan, step)).state, "complete", step.id);
      await assert.rejects(preflight(plan, step, reader), /already complete/);
    }
    for (const network of networks) {
      const result = await reader(network.chainId).readContract({ address: plan.deployments.NamepassFactory.address, abi: bundle.contracts.NamepassFactory.abi, functionName: "predictWallet", args: ["vitalik"] });
      assert.equal(result, predictWallet(plan, "vitalik"));
    }
    // Real timelock transactions change only the helper and then restore the original.
    const upgrade = buildUpgrade(plan);
    const upgradeRecords: UpgradeRecord[] = [];
    const hubWallet = createWalletClient({ account, chain: undefined, transport: http(urls.get(HUB)!) });
    assert.equal((await checkUpgrade(plan, [], reader)).next, "deploy");
    await assert.rejects(prepareUpgrade(plan, "activate", [], reader), /next rehearsal step/);
    for (const id of ["deploy", "schedule", "activate", "schedule-restore", "restore"] as const) {
      const tx = staticUpgradeTx(plan, id);
      if (id === "activate" || id === "restore") {
        await assert.rejects(reader(HUB).call({ account: account.address, ...tx }));
        await fetch(urls.get(HUB)!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [301] }) });
        await fetch(urls.get(HUB)!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });
      }
      const hash = await hubWallet.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
      await reader(HUB).waitForTransactionReceipt({ hash });
      const record: UpgradeRecord = { id, hash, status: "pending", tx: { chainId: HUB, to: tx.to, data: tx.data } };
      const verified = await verifyUpgradeRecord(plan, { ...record, evidence: { untrustedPriorValue: 1n } }, reader);
      assert.equal(verified.status, "verified"); upgradeRecords.push({ ...record, ...verified });
      if (id === "schedule") {
        assert.equal((await checkUpgrade(plan, upgradeRecords, reader)).next, "fund");
        await assert.rejects(prepareUpgrade(plan, "activate", upgradeRecords, reader), /next rehearsal step/);
      }
      if (id === "activate") {
        await verifyDeployment(reader(HUB), upgrade.helperPlan, upgrade.helper);
        await verifyDeployment(reader(HUB), upgrade.helperPlan, plan.deployments.RenewalHelperPointer);
        await assert.rejects(checkUpgrade(plan, upgradeRecords, reader), /Earlier rehearsal receipts/);
      }
    }
    await verifyDeployment(reader(HUB), plan, plan.deployments.RenewalHelperPointer);
    // One altered immutable byte must fail runtime verification, not be masked out.
    const deployed = plan.deployments.NamepassL1Gateway;
    const position = bundle.contracts.NamepassL1Gateway.immutables[0].positions[0].start;
    const wrong = `${deployed.runtime.slice(0, 2 + position * 2)}ff${deployed.runtime.slice(4 + position * 2)}`;
    await fetch(urls.get(HUB)!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setCode", params: [deployed.address, wrong] }) });
    await assert.rejects(verifyDeployment(reader(HUB), plan, deployed), /Bytecode mismatch/);
  } finally {
    for (const child of processes) child.kill("SIGTERM");
    await Promise.all(processes.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve))));
  }
});
