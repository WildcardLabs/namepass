import assert from "node:assert/strict";
import test from "node:test";
import { readSourceStatus } from "./source-status";

const address = "0xFF4F3a9a416a51b8A2b601F5e17c94635b5aaCf4";
const identity = { chainId: "11155111", address };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("unverified Sourcify 404 permits publication instead of throwing", async () => {
  assert.equal(await readSourceStatus(11155111, address, reply(404, { ...identity, match: null, creationMatch: null, runtimeMatch: null })), false);
});
test("activation requires matching creation and runtime for the exact contract", async () => {
  assert.equal(await readSourceStatus(11155111, address, reply(200, { ...identity, creationMatch: "match", runtimeMatch: "exact_match" })), true);
  for (const creationMatch of [null, "unknown", "error"]) assert.equal(await readSourceStatus(11155111, address, reply(200, { ...identity, creationMatch, runtimeMatch: "match" })), false);
  await assert.rejects(readSourceStatus(11155111, address, reply(200, { ...identity, chainId: "1", creationMatch: "match", runtimeMatch: "match" })), /requested contract/);
});
test("unrelated 404, malformed JSON, and service errors remain errors", async () => {
  await assert.rejects(readSourceStatus(11155111, address, reply(404, { error: "Not found" })), /requested contract/);
  await assert.rejects(readSourceStatus(11155111, address, (async () => new Response("html", { status: 404 })) as typeof fetch), /invalid response/);
  await assert.rejects(readSourceStatus(11155111, address, reply(503, {})), /HTTP 503/);
});
