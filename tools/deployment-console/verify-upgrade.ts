import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, type PublicClient } from "viem";
import { buildPlan, HUB } from "./model";
import { json, parseSession } from "./storage";
import { buildUpgrade, checkUpgrade, parseUpgrade, UPGRADE_ORIGIN } from "./upgrade";
const [manifestPath, evidencePath, outputPath] = process.argv.slice(2);
assert(manifestPath && evidencePath && outputPath, "Usage: verify-upgrade.ts MANIFEST REHEARSAL REPORT");
const plan = buildPlan(parseSession(readFileSync(manifestPath, "utf8")).config);
const evidence = parseUpgrade(readFileSync(evidencePath, "utf8"), plan);
const clients = new Map<number, PublicClient>([
  [HUB, createPublicClient({ transport: http("https://ethereum-sepolia-rpc.publicnode.com") }) as PublicClient],
  [UPGRADE_ORIGIN, createPublicClient({ transport: http("https://rpc.testnet.arc.network") }) as PublicClient],
]);
const reader = (id: number) => { const client = clients.get(id); assert(client); return client; };
const result = await checkUpgrade(plan, evidence.records, reader);
const report = { checkedAt: new Date().toISOString(), fingerprint: plan.fingerprint, helperB: buildUpgrade(plan).helper.address, ...result };
writeFileSync(outputPath, `${json(report)}\n`);
console.log(json({ complete: result.complete, next: result.next, active: result.active, records: result.records.length }));
assert(result.complete, "Rehearsal is not complete");
