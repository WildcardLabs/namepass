import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildPlan, bundle } from "./model";
import { resolverDeployment, resolverArtifact } from "./resolver";
import { parseSession } from "./storage";
const manifest = JSON.parse(readFileSync(new URL("../../docs/deployments/2026-09-18/manifest.json", import.meta.url), "utf8"));
const plan = buildPlan(manifest.config);
const config = { apex: "0xf80E70eBC4184850f9fBCDC8De7CB4C86C46abF6" as const, avatar: "", description: "", url: "", gatewayUrl: "https://demo-five-gray-37.vercel.app/api/ccip/{sender}/{data}" };
test("replacement resolver uses the corrected factory and rejects the old deployment manifest", () => {
 assert.notEqual(bundle.fingerprint, manifest.artifactFingerprint);
 assert.throws(() => parseSession(JSON.stringify(manifest)));
 assert.notEqual(plan.fingerprint, manifest.fingerprint);
 const deployment = resolverDeployment(plan, config);
 // The optimizer can encode an address with shifts; check the compiled source binding.
 assert.ok(JSON.stringify(resolverArtifact.standardInput).includes(`address constant FACTORY = ${plan.deployments.NamepassFactory.address};`));
 assert.notEqual(deployment.address, resolverDeployment(plan, { ...config, gatewayUrl: "https://changed.example/api/ccip" }).address);
});
