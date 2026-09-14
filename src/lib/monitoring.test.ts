import { describe, test, expect } from "vitest";
import { needsAttention, exactUsdc, type MonitorFlow } from "./monitoring";
const now = Date.parse("2026-09-14T12:00:00Z");
const flow = (status: MonitorFlow["status"], minutes: number): MonitorFlow => ({
  id: "id",
  name: "test.eth",
  chainId: 84532,
  status,
  amount: "1000000",
  stageAt: new Date(now - minutes * 60_000).toISOString(),
  nextActionAt: null,
  reason: null,
  txHash: null,
});
describe("monitoring review rules", () => {
  test("normal standard-transfer waits are not stuck", () => {
    expect(needsAttention(flow("waiting_attestation", 20), "base", now)).toBe(
      false,
    );
    expect(needsAttention(flow("waiting_attestation", 61), "base", now)).toBe(
      true,
    );
    expect(needsAttention(flow("waiting_attestation", 6), "arc", now)).toBe(
      true,
    );
  });
  test("held and terminal outcomes are not timed as ongoing steps", () => {
    for (const state of ["held", "settled", "cancelled"] as const)
      expect(needsAttention(flow(state, 10000), "base", now)).toBe(false);
    expect(needsAttention(flow("unclaimed", 0), "base", now)).toBe(true);
    expect(needsAttention(flow("failed", 0), "base", now)).toBe(true);
  });
  test("receipt waits have a separate budget", () => {
    expect(needsAttention(flow("waiting_claim", 14), "base", now)).toBe(false);
    expect(needsAttention(flow("waiting_claim", 16), "base", now)).toBe(true);
  });
  test("USDC formatting keeps micro-units beyond Number precision", () => {
    expect(exactUsdc("9007199254740993000001")).toBe(
      "$9,007,199,254,740,993.000001",
    );
    expect(exactUsdc("1")).toBe("$0.000001");
  });
});
