import type { FlowStatus } from "./flowTypes";

export interface MonitorFlow {
  id: string;
  name: string;
  chainId: number;
  status: FlowStatus;
  amount: string;
  stageAt: string;
  nextActionAt: string | null;
  reason: string | null;
  txHash: string | null;
}
export const ACTIVE_FLOW_STATES = [
  "queued",
  "confirming_deposit",
  "checking_name",
  "submitting_origin",
  "waiting_origin",
  "waiting_attestation",
  "submitting_claim",
  "waiting_claim",
] as const;
/** Review thresholds, not proof of failure or a provider SLA. */
export function stageBudgetMinutes(status: string, chainKey: string): number {
  if (status === "waiting_attestation") return chainKey === "arc" ? 5 : 60;
  if (status === "waiting_origin" || status === "waiting_claim") return 15;
  return 10;
}
export function needsAttention(
  flow: MonitorFlow,
  chainKey: string,
  now: number,
): boolean {
  if (flow.status === "failed" || flow.status === "unclaimed") return true;
  if (!(ACTIVE_FLOW_STATES as readonly string[]).includes(flow.status))
    return false;
  return (
    now - Date.parse(flow.stageAt) >
    stageBudgetMinutes(flow.status, chainKey) * 60_000
  );
}
export interface MonitorRead {
  generatedAt: string;
  totals: {
    names: string;
    depositors: string;
    deposits: string;
    depositVolume: string;
    renewals: string;
    received: string;
    applied: string;
    seconds: string;
    scans: string;
    expiring: string;
  };
  states: { status: FlowStatus; count: string; amount: string }[];
  daily: {
    day: string;
    renewals: number;
    received: string;
    deposits: number;
  }[];
  chains: {
    chainId: number;
    deposits: string;
    volume: string;
    lastEventAt: string | null;
    ingestionP95: number | null;
  }[];
  flows: MonitorFlow[];
  flowCount: string;
  reviewCount: string;
  matchingFlowCount: string;
  latency: { chainId: number; samples: number; p50: number; p95: number }[];
  intents: { chainId: number; pending: string; warned: string }[];
}
export interface GasRead {
  checkedAt: string;
  address: string | null;
  chains: {
    chainId: number;
    balance: string | null;
    symbol: string;
    error: string | null;
  }[];
}
export function exactUsdc(value: string): string {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  return `${sign}$${(abs / 1_000_000n).toLocaleString("en-US")}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
}
