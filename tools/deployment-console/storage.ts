import { keccak256, type Hex } from "viem";
import { buildPlan, bundle, type Config, type Plan } from "./model";

export const STORAGE_KEY = `namepass:deployment-console:v2:${bundle.fingerprint}`;
export type Entry = { hash: Hex; chainId: number; dataHash: Hex; submittedAt: string; blockNumber?: string; status: "submitted" | "confirmed" | "reverted" | "cancelled" };
export type Session = { schema: 1; artifactFingerprint: Hex; fingerprint: Hex; config: Config; journal: Record<string, Entry> };
export function newSession(config: Config): Session {
  const plan = buildPlan(config);
  return { schema: 1, artifactFingerprint: bundle.fingerprint, fingerprint: plan.fingerprint, config: plan.config, journal: {} };
}
export function parseSession(text: string): Session {
  const value = JSON.parse(text) as Session;
  if (value.schema !== 1 || value.artifactFingerprint !== bundle.fingerprint) throw new Error("This file uses a different console version or contract build. Use the original build to resume it.");
  const plan = buildPlan(value.config);
  if (plan.fingerprint !== value.fingerprint || !value.journal || typeof value.journal !== "object") throw new Error("Deployment file does not match its configuration.");
  for (const [id, entry] of Object.entries(value.journal)) {
    const step = plan.steps.find(s => s.id === id);
    if (!step || entry.chainId !== step.chainId || !/^0x[0-9a-fA-F]{64}$/.test(entry.hash) || entry.dataHash !== keccak256(step.data) || !["submitted", "confirmed", "reverted", "cancelled"].includes(entry.status)) throw new Error("Deployment file contains an invalid transaction record.");
  }
  return { schema: 1, artifactFingerprint: bundle.fingerprint, fingerprint: plan.fingerprint, config: plan.config, journal: value.journal };
}
export function manifest(session: Session, plan: Plan, verification: unknown) {
  return {
    ...session, exportedAt: new Date().toISOString(), verification,
    contracts: Object.fromEntries(Object.values(plan.deployments).map(d => [d.name, {
      address: d.address, salt: d.salt, creationCodeHash: keccak256(d.initcode), runtimeCodeHash: keccak256(d.runtime),
      constructorArgs: d.constructorArgs, compiler: bundle.contracts[d.name].compiler,
    }])),
    activation: { operationId: plan.operationId, salt: plan.operationSalt, calldata: plan.updateData },
    note: "Transaction records are not proof of completion. Recheck all on-chain state before cutover.",
  };
}
export function json(value: unknown) { return JSON.stringify(value, (_, v: unknown) => typeof v === "bigint" ? v.toString() : v, 2); }
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([json(value)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
