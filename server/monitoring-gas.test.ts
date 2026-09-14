import assert from "node:assert/strict";
import test from "node:test";
import { SERVER_CHAINS } from "../src/lib/chains";
import { monitoringGas } from "./monitoring-gas";

test("manual gas checks preserve partial failures, Arc units, and coalesce cached reads", async () => {
 const keys = ["RELAYER_ADDRESS", "RELAYER_PRIVATE_KEY", ...SERVER_CHAINS.map(c => c.rpcEnv)];
 const previous = new Map(keys.map(key => [key, process.env[key]]));
 const previousFetch = globalThis.fetch;
 let calls = 0;
 try {
  delete process.env.RELAYER_PRIVATE_KEY;
  process.env.RELAYER_ADDRESS = "0x0000000000000000000000000000000000000001";
  for (const chain of SERVER_CHAINS) process.env[chain.rpcEnv] = `https://rpc.invalid/${chain.key}`;
  globalThis.fetch = async (input, init) => {
   calls++;
   const request = JSON.parse(String(init?.body));
   assert.equal(request.method, "eth_getBalance");
   if (String(input).endsWith("/base")) throw new Error("RPC unavailable");
   return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0xde0b6b3a7640000" }), { headers: { "content-type": "application/json" } });
  };
  const [first, second] = await Promise.all([monitoringGas(), monitoringGas()]);
  assert.deepEqual(first, second);
  assert.equal(calls, SERVER_CHAINS.length);
  assert.equal(first.chains.find(c => c.chainId === SERVER_CHAINS.find(c => c.key === "arc")!.chainId)?.balance, "1");
  assert.equal(first.chains.find(c => c.chainId === SERVER_CHAINS.find(c => c.key === "arc")!.chainId)?.symbol, "USDC");
  assert.equal(first.chains.find(c => c.chainId === SERVER_CHAINS.find(c => c.key === "base")!.chainId)?.balance, null);
  await monitoringGas();
  assert.equal(calls, SERVER_CHAINS.length);
 } finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
 }
});
