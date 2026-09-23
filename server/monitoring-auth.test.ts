import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { COOKIE, githubCallback, githubLogin, monitoringSession } from "./monitoring-auth";

test("GitHub callback issues separate cookies and sessions reject tampering, expiry and removed users", async () => {
 const keys = ["MONITORING_GITHUB_CLIENT_ID", "MONITORING_GITHUB_CLIENT_SECRET", "MONITORING_SESSION_SECRET", "MONITORING_GITHUB_USERS"];
 const previous = keys.map(k => process.env[k]);
 const originalFetch = globalThis.fetch;
 try {
  process.env.MONITORING_GITHUB_CLIENT_ID = "test-client";
  process.env.MONITORING_GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.MONITORING_SESSION_SECRET = "a".repeat(32);
  process.env.MONITORING_GITHUB_USERS = "devone,devtwo";
  const login = githubLogin(new Request("https://example.com/api/auth/github"));
  const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = login.headers.get("set-cookie")!.split(";")[0];
  let calls = 0;
  globalThis.fetch = async () => Response.json(++calls === 1 ? { access_token: "test-token" } : { login: "devone", id: 123 });
  await assert.rejects(githubCallback(new Request("https://example.com/api/auth/github/callback?code=x&state=wrong", { headers: { cookie: stateCookie } })), /expired/);
  assert.equal(calls, 0);
  const response = await githubCallback(new Request(`https://example.com/api/auth/github/callback?code=x&state=${state}`, { headers: { cookie: stateCookie } }));
  assert.equal(response.headers.getSetCookie().length, 2);
  const sessionCookie = response.headers.getSetCookie()[0].split(";")[0];
  const req = (cookie: string) => new Request("https://example.com/api/monitoring", { headers: { cookie } });
  assert.deepEqual(monitoringSession(req(sessionCookie)), { login: "devone" });
  assert.equal(monitoringSession(req(sessionCookie + "tampered")), null);
  for (const time of [Math.floor(Date.now() / 1000) - 43201, Math.floor(Date.now() / 1000) + 3600]) {
   const payload = `devone:123:${time}`;
   const signature: string = createHmac("sha256", "a".repeat(32)).update(payload).digest("base64url");
   assert.equal(monitoringSession(req(`${COOKIE}=${payload}.${signature}`)), null);
  }
  process.env.MONITORING_GITHUB_USERS = "devtwo,devthree";
  assert.equal(monitoringSession(req(sessionCookie)), null);
 } finally {
  globalThis.fetch = originalFetch;
  keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
 }
});
