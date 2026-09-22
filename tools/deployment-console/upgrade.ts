import { concat, decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, getCreate2Address, keccak256, stringToHex, zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { bundle, HUB, inspectStep, network, predictWallet, requireCode, SINGLETON, SINGLETON_RUNTIME, type Deployment, type Plan } from "./model";
import { assertAttestedSource, ensure, originEvidence, prepareCanary, TEST_AMOUNT, validateMessage, verifyCanaryReceipt, type CanaryRecord, type TestTx } from "./canary";

export const UPGRADE_ORIGIN = 5042002;
export const UPGRADE_LABEL = "steve";
export const UPGRADE_STEPS = ["deploy", "schedule", "fund", "burn", "activate", "claim", "schedule-restore", "restore"] as const;
export type UpgradeStep = typeof UPGRADE_STEPS[number];
export type UpgradeRecord = { id: UpgradeStep; hash: Hex; status: "pending" | "verified" | "reverted" | "cancelled"; tx: { chainId: number; to: Address; data: Hex }; evidence?: unknown };
export type UpgradeSession = { version: 1; fingerprint: Hex; records: UpgradeRecord[] };
export const upgradeTitles: Record<UpgradeStep, string> = {
  deploy: "Deploy replacement helper B", schedule: "Schedule helper B", fund: "Fund the Arc test wallet", burn: "Burn on Arc while helper A is active", activate: "Activate helper B", claim: "Claim through helper B on Sepolia", "schedule-restore": "Schedule original helper A", restore: "Restore helper A",
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function buildUpgrade(plan: Plan) {
  const original = plan.deployments.ENSV2RenewalHelper;
  const salt = keccak256(stringToHex(`${plan.config.saltLabel}:inflight-helper-B-v1`));
  const helper: Deployment = { ...original, salt, address: getCreate2Address({ from: SINGLETON, salt, bytecode: original.initcode }) };
  const helperPlan: Plan = { ...plan, deployments: { ...plan.deployments, ENSV2RenewalHelper: helper } };
  function operation(next: Address, suffix: string) {
    const data = encodeFunctionData({ abi: bundle.contracts.RenewalHelperPointer.abi, functionName: "setHelper", args: [next] });
    const operationSalt = keccak256(stringToHex(`${plan.config.saltLabel}:inflight-${suffix}-v1`));
    const args = [plan.deployments.RenewalHelperPointer.address, 0n, data, zeroHash, operationSalt] as const;
    return {
      id: keccak256(encodeAbiParameters([{type:"address"},{type:"uint256"},{type:"bytes"},{type:"bytes32"},{type:"bytes32"}], args)),
      salt: operationSalt,
      schedule: encodeFunctionData({ abi: bundle.contracts.TimelockController.abi, functionName: "schedule", args: [...args, BigInt(plan.config.delay)] }),
      execute: encodeFunctionData({ abi: bundle.contracts.TimelockController.abi, functionName: "execute", args }),
    };
  }
  return { helper, helperPlan, activate: operation(helper.address, "activate-B"), restore: operation(original.address, "restore-A") };
}
export function parseUpgrade(text: string, plan: Plan): UpgradeSession {
  const value = JSON.parse(text) as UpgradeSession;
  ensure(value.version === 1 && value.fingerprint === plan.fingerprint && Array.isArray(value.records), "Upgrade evidence does not match this deployment");
  const hashes = new Set<string>();
  for (const record of value.records) {
    ensure(UPGRADE_STEPS.includes(record.id) && /^0x[0-9a-f]{64}$/i.test(record.hash) && !hashes.has(record.hash.toLowerCase()), "Invalid upgrade transaction record");
    hashes.add(record.hash.toLowerCase());
    ensure(["pending", "verified", "reverted", "cancelled"].includes(record.status), "Invalid upgrade status");
    ensure(record.tx.chainId === (["fund", "burn"].includes(record.id) ? UPGRADE_ORIGIN : HUB), "Unexpected upgrade chain");
    ensure(/^0x[0-9a-f]{40}$/i.test(record.tx.to) && /^0x(?:[0-9a-f]{2})+$/i.test(record.tx.data), "Invalid upgrade transaction");
    if (record.id !== "claim") { const expected = staticUpgradeTx(plan, record.id); ensure(same(expected.to, record.tx.to) && expected.data === record.tx.data, "Unexpected upgrade calldata"); }
    else ensure(same(record.tx.to, plan.deployments.NamepassL1Gateway.address), "Unexpected claim target");
  }
  return value;
}
export function staticUpgradeTx(plan: Plan, id: Exclude<UpgradeStep, "claim">): TestTx {
  const upgrade = buildUpgrade(plan), timelock = plan.deployments.TimelockController.address;
  const l1 = (to: Address, data: Hex): TestTx => ({ chainId: HUB, to, data, value: 0n });
  if (id === "deploy") return l1(SINGLETON, concat([upgrade.helper.salt, upgrade.helper.initcode]));
  if (id === "schedule") return l1(timelock, upgrade.activate.schedule);
  if (id === "activate") return l1(timelock, upgrade.activate.execute);
  if (id === "schedule-restore") return l1(timelock, upgrade.restore.schedule);
  if (id === "restore") return l1(timelock, upgrade.restore.execute);
  return { chainId: UPGRADE_ORIGIN, to: id === "fund" ? network(UPGRADE_ORIGIN).usdcAddress as Address : plan.deployments.NamepassFactory.address, data: id === "fund" ? encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [predictWallet(plan, UPGRADE_LABEL), TEST_AMOUNT] }) : encodeFunctionData({ abi: bundle.contracts.NamepassFactory.abi, functionName: "renew", args: [UPGRADE_LABEL] }), value: 0n };
}
function canary(record: UpgradeRecord): CanaryRecord {
  return { label: UPGRADE_LABEL, origin: UPGRADE_ORIGIN, action: record.id === "burn" ? "renew" : record.id as "fund" | "claim", hash: record.hash, tx: record.tx, status: record.status === "verified" ? "verified" : "pending" };
}
export async function verifyUpgradeRecord(plan: Plan, record: UpgradeRecord, reader: (id: number) => PublicClient) {
  parseUpgrade(JSON.stringify({ version: 1, fingerprint: plan.fingerprint, records: [{ ...record, evidence: undefined }] }), plan);
  const upgrade = buildUpgrade(plan), client = reader(record.tx.chainId);
  const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: record.hash }), client.getTransaction({ hash: record.hash })]);
  ensure(same(tx.from, plan.config.owner), "Unexpected transaction sender");
  ensure((await client.getBlock({ blockNumber: receipt.blockNumber })).hash === receipt.blockHash, "Receipt is no longer canonical");
  if (!tx.to || !same(tx.to, record.tx.to) || tx.input !== record.tx.data || tx.value !== 0n) return { status: "cancelled" as const, evidence: { blockNumber: receipt.blockNumber.toString() } };
  if (receipt.status !== "success") return { status: "reverted" as const, evidence: { blockNumber: receipt.blockNumber.toString() } };
  if (["fund", "burn", "claim"].includes(record.id)) return verifyCanaryReceipt(record.id === "claim" ? upgrade.helperPlan : plan, canary(record), reader);
  if (record.id === "deploy") await requireCode(client, upgrade.helper.address, upgrade.helper.runtime);
  if (record.id === "activate" || record.id === "restore") {
    const expected = record.id === "activate" ? upgrade.helper.address : plan.deployments.ENSV2RenewalHelper.address;
    const previous = record.id === "activate" ? plan.deployments.ENSV2RenewalHelper.address : upgrade.helper.address;
    const changes = receipt.logs.filter(log => same(log.address, plan.deployments.RenewalHelperPointer.address)).flatMap(log => {
      try { const event = decodeEventLog({ abi: bundle.contracts.RenewalHelperPointer.abi, data: log.data, topics: log.topics }); return event.eventName === "HelperUpdated" ? [event.args as unknown as { previousHelper: Address; newHelper: Address; codeHash: Hex }] : []; } catch { return []; }
    });
    ensure(changes.length === 1 && same(changes[0].newHelper, expected) && same(changes[0].previousHelper, previous) && changes[0].codeHash === keccak256(upgrade.helper.runtime), "Pointer update does not match the rehearsal");
  }
  return { status: "verified" as const, evidence: { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash } };
}
export async function checkUpgrade(plan: Plan, records: UpgradeRecord[], reader: (id: number) => PublicClient) {
  const upgrade = buildUpgrade(plan), verified: UpgradeRecord[] = [];
  for (const record of records) verified.push({ ...record, ...await verifyUpgradeRecord(plan, record, reader) });
  const completed = new Set(verified.filter(r => r.status === "verified").map(r => r.id));
  for (const id of UPGRADE_STEPS) ensure(verified.filter(r => r.id === id && r.status === "verified").length <= 1, "Multiple successful transactions recorded for one rehearsal step");
  const next = UPGRADE_STEPS.find(id => !completed.has(id));
  for (let i = 0; i < UPGRADE_STEPS.length; i++) if (completed.has(UPGRADE_STEPS[i])) ensure(UPGRADE_STEPS.slice(0, i).every(id => completed.has(id)), "Earlier rehearsal receipts are missing. Recover them before continuing.");
  const client = reader(HUB);
  ensure(await client.getChainId() === HUB && await reader(UPGRADE_ORIGIN).getChainId() === UPGRADE_ORIGIN, "RPC chain mismatch");
  const pointer = plan.deployments.RenewalHelperPointer.address;
  const active = await client.readContract({ address: pointer, abi: bundle.contracts.RenewalHelperPointer.abi, functionName: "currentHelper" }) as Address;
  const expected = completed.has("activate") && !completed.has("restore") ? upgrade.helper.address : plan.deployments.ENSV2RenewalHelper.address;
  ensure(same(active, expected), "Current helper differs from saved rehearsal progress. Recover any missing activation/restore receipt.");
  const statePlan = same(active, upgrade.helper.address) ? upgrade.helperPlan : plan;
  for (const step of statePlan.steps.filter(step => step.chainId === HUB || step.chainId === UPGRADE_ORIGIN)) ensure((await inspectStep(reader(step.chainId), statePlan, step)).state === "complete", "Fixed deployment configuration changed");
  if (completed.has("deploy")) await requireCode(client, upgrade.helper.address, upgrade.helper.runtime);
  let waitingUntil: number | undefined;
  if (next === "activate" || next === "restore") {
    const operation = next === "activate" ? upgrade.activate : upgrade.restore;
    const timestamp = await client.readContract({ address: plan.deployments.TimelockController.address, abi: bundle.contracts.TimelockController.abi, functionName: "getTimestamp", args: [operation.id] }) as bigint;
    ensure(timestamp > 1n, "Operation is not scheduled or has already executed. Recover its receipt.");
    if ((await client.getBlock()).timestamp < timestamp) waitingUntil = Number(timestamp);
  }
  if (completed.has("activate")) {
    const receipt = (id: UpgradeStep) => { const record = verified.find(r => r.id === id && r.status === "verified")!; return reader(record.tx.chainId).getTransactionReceipt({ hash: record.hash }); };
    const burn = await receipt("burn"), activate = await receipt("activate");
    const [burnBlock, activateBlock] = await Promise.all([reader(UPGRADE_ORIGIN).getBlock({ blockNumber: burn.blockNumber }), client.getBlock({ blockNumber: activate.blockNumber })]);
    ensure(burnBlock.timestamp < activateBlock.timestamp, "Source burn did not precede the helper switch");
    if (completed.has("claim")) {
      const claim = await receipt("claim"); ensure(claim.blockNumber > activate.blockNumber, "Claim did not follow the helper switch");
      if (completed.has("restore")) ensure((await receipt("restore")).blockNumber > claim.blockNumber, "Restoration did not follow the helper B claim");
      const record = verified.find(r => r.id === "claim" && r.status === "verified")!;
      const call = decodeFunctionData({ abi: bundle.contracts.NamepassL1Gateway.abi, data: record.tx.data });
      ensure(call.functionName === "completeCCTP", "Wrong claim function");
      validateMessage(plan, UPGRADE_ORIGIN, UPGRADE_LABEL, call.args![0] as Hex, true);
      assertAttestedSource(originEvidence(plan, UPGRADE_ORIGIN, UPGRADE_LABEL, burn).message, call.args![0] as Hex);
    }
  }
  return { records: verified, next, active, waitingUntil, complete: !next };
}
export async function prepareUpgrade(plan: Plan, id: UpgradeStep, records: UpgradeRecord[], reader: (id: number) => PublicClient) {
  const state = await checkUpgrade(plan, records, reader), upgrade = buildUpgrade(plan);
  ensure(state.next === id && !state.waitingUntil, state.waitingUntil ? "Timelock delay is still running" : "This is not the next rehearsal step");
  ensure(!records.some(r => r.status === "pending"), "Check the pending receipt first");
  if (id === "claim") return prepareCanary(upgrade.helperPlan, UPGRADE_ORIGIN, UPGRADE_LABEL, "claim", state.records.filter(r => ["fund", "burn"].includes(r.id)).map(canary), reader);
  if (id === "fund" || id === "burn") return prepareCanary(plan, UPGRADE_ORIGIN, UPGRADE_LABEL, id === "fund" ? "fund" : "renew", state.records.filter(r => ["fund", "burn"].includes(r.id)).map(canary), reader);
  if (id === "deploy") {
    await requireCode(reader(HUB), SINGLETON, SINGLETON_RUNTIME);
    const code = await reader(HUB).getBytecode({ address: upgrade.helper.address });
    ensure(!code || code === "0x", "Helper B already exists. Recover its deployment receipt.");
  }
  return staticUpgradeTx(plan, id);
}

export function exportUpgrade(plan: Plan, records: UpgradeRecord[]) {
  return { version: 1, fingerprint: plan.fingerprint, exportedAt: new Date().toISOString(), config: plan.config, helperA: plan.deployments.ENSV2RenewalHelper.address, helperB: buildUpgrade(plan).helper, records };
}
