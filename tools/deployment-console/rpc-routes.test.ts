import assert from "node:assert/strict";
import test from "node:test";
import config from "./vite.config";

test("each RPC path matches only its own proxy, including mainnet and Sepolia", () => {
  const keys = Object.keys((config as any).server.proxy).filter(key => key.startsWith("^/rpc/"));
  for (const id of [1, 11155111, 84532, 421614, 5042002]) {
    for (const suffix of ["", "/"]) {
      const matches = keys.filter(key => new RegExp(key).test(`/rpc/${id}${suffix}`));
      assert.deepEqual(matches, [`^/rpc/${id}(?:/|$)`]);
    }
  }
  assert.equal(keys.some(key => new RegExp(key).test("/rpc/111551110")), false);
});
