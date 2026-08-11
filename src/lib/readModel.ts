import { labelLength, solve } from "./pricing";
import { chainById, HUB_CHAIN } from "./chains";
import { micro, milliseconds, safeInteger, type ActivityRead, type LeaderboardRead, type NameActivityRead, type PublicChainBalance, type PublicFlow, type PublicName, type PublicRenewal } from "./publicApi";
import { minTrigger } from "./triggerConfig";

export { minTrigger, setPublicConfig } from "./triggerConfig";

export type EventKind = "activated" | "deposit" | "renewal";
export type FlowStatus = "signing" | "burning" | "attesting" | "claiming";
export type HoldReason = "flow_in_progress" | "below_threshold" | "name_inactive" | "not_detected" | "flow_failed" | "unknown";

export interface FlowStep { kind: "deposit" | "burn" | "renewal"; chain: string; tx: string; }
export interface ActivityEvent {
	id: string; kind: EventKind; at: number; chain: string; amountDeposited: bigint;
	gasAllowance: bigint; amountApplied: bigint; seconds: bigint; off: string;
	nameExpiryAfter: number | null; funder: string; executor: string; executorIsRelayer: boolean; steps: FlowStep[];
}
export interface ChainBalance { chainId: string; chain: string; amount: bigint | null; holdReason: HoldReason; }
export interface ChainFlow { chain: string; amount: bigint; status: FlowStatus; startedAt: number; id: string; api: PublicFlow; }
export interface PendingState { balances: ChainBalance[]; flows: ChainFlow[]; renewable: boolean; gasAllowance: bigint; }
export interface NameRecord {
	name: string; labelLength: number; address: string; onchain: { expiry: number | null; renewable: boolean; graceRemaining: number | null; lapsedFor: number | null } | null;
	activatedAt: number; expiryAtActivation: number; lifetimeReceived: bigint; timeDeliveredSeconds: bigint; renewalCount: bigint; events: ActivityEvent[]; pending: PendingState; flows: PublicFlow[];
}

function chainName(chainId: string): string {
	return chainById(safeInteger(chainId) ?? -1)?.name ?? chainId;
}

export function renewalEvent(renewal: PublicRenewal, label: string): ActivityEvent {
	const chain = chainName(renewal.originChainId);
	const amountApplied = micro(renewal.amountApplied);
	const steps: FlowStep[] = [];
	if (renewal.depositTxHash) steps.push({ kind: "deposit", chain, tx: renewal.depositTxHash });
	if (renewal.fromCctp && renewal.originTxHash) {
		steps.push({ kind: "burn", chain, tx: renewal.originTxHash });
	}
	steps.push({ kind: "renewal", chain: HUB_CHAIN.name, tx: renewal.renewalTxHash });
	return {
		id: renewal.eventId,
		kind: "renewal",
		at: milliseconds(renewal.blockTime),
		chain,
		amountDeposited: micro(renewal.amountReceived),
		gasAllowance: micro(renewal.gasAllowance),
		amountApplied,
		seconds: micro(renewal.durationSeconds),
		off: solve(amountApplied, labelLength(label)).off,
		nameExpiryAfter: renewal.expiryAfter ? milliseconds(renewal.expiryAfter) : null,
		funder: renewal.funderAddress ?? "Sender unavailable",
		executor: renewal.executorAddress,
		executorIsRelayer: renewal.executorIsRelayer,
		steps,
	};
}

function balanceReason(name: PublicName, flow: PublicFlow | undefined, balance: PublicChainBalance): HoldReason {
	if (balance.amount === null) return "unknown";
	if (flow) return holdReason(flow);
	if (!name.renewableBy) return "name_inactive";
	const minimum = minTrigger(balance.chainId);
	return minimum === undefined || micro(balance.amount) < minimum ? "unknown" : "not_detected";
}

function safeMilliseconds(seconds: bigint): number | undefined {
	const value = seconds * 1_000n;
	return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

const records = new Map<string, NameRecord>();

function flowStatus(flow: PublicFlow): FlowStatus {
	if (flow.status === "waiting_attestation") return "attesting";
	if (flow.status === "submitting_origin" || flow.status === "waiting_origin") return "burning";
	if (flow.status === "queued" || flow.status === "confirming_deposit" || flow.status === "checking_name") return "signing";
	return "claiming";
}

function holdReason(flow: PublicFlow): HoldReason {
	if (flow.status === "failed") return "flow_failed";
	if (flow.holdReason === "balance_recovery") return "not_detected";
	if (flow.holdReason?.includes("threshold")) return "below_threshold";
	return "name_inactive";
}

function setName(name: PublicName, activity?: NameActivityRead): NameRecord {
	const expiry = name.currentExpiry ? milliseconds(name.currentExpiry) : null;
	const current = records.get(name.label);
	const events: ActivityEvent[] = activity ? [
		{ id: `activation:${name.label}`, kind: "activated", at: milliseconds(name.activatedAt), chain: "Ethereum", amountDeposited: 0n, gasAllowance: 0n, amountApplied: 0n, seconds: 0n, off: "", nameExpiryAfter: expiry, funder: "", executor: "", executorIsRelayer: false, steps: [] },
		...activity.renewals.map((renewal) => renewalEvent(renewal, name.label)),
	] : current?.events ?? [];
	const sourceFlows = activity?.flows ?? [];
	const sourceBalances = activity?.balances ?? [];
	const pending: PendingState = {
		renewable: Boolean(name.renewableBy), gasAllowance: 0n,
		flows: sourceFlows.filter((flow) => !["held", "failed", "settled", "cancelled", "unclaimed"].includes(flow.status)).map((flow) => ({ chain: chainName(flow.originChainId), amount: micro(flow.amountDetected), status: flowStatus(flow), startedAt: milliseconds(flow.createdAt), id: flow.id, api: flow })),
		balances: sourceBalances
			.filter((balance) => balance.amount === null || micro(balance.amount) > 0n)
			.map((balance) => {
				const flow = sourceFlows.find((candidate) => candidate.originChainId === balance.chainId && ["held", "failed"].includes(candidate.status));
				return { chainId: balance.chainId, chain: chainName(balance.chainId), amount: balance.amount === null ? null : micro(balance.amount), holdReason: balanceReason(name, flow, balance) };
			}),
	};
	const timeDeliveredSeconds = micro(name.timeDeliveredSeconds);
	const record: NameRecord = { name: name.displayName, labelLength: labelLength(name.label), address: name.depositAddress, onchain: { expiry, renewable: Boolean(name.renewableBy), graceRemaining: null, lapsedFor: expiry && expiry < Date.now() ? Date.now() - expiry : null }, activatedAt: milliseconds(name.activatedAt), expiryAtActivation: expiry ? expiry - (safeMilliseconds(timeDeliveredSeconds) ?? 0) : 0, lifetimeReceived: micro(name.lifetimeReceived), timeDeliveredSeconds, renewalCount: micro(name.renewalCount), events, pending, flows: sourceFlows };
	records.set(name.label, record);
	return record;
}

export function syncFeed(feed: ActivityRead): void {
	const received = new Set(feed.items.map((item) => item.renewal.eventId));
	for (const item of feed.items) {
		const record = setName(item.name);
		const next = renewalEvent(item.renewal, item.name.label);
		const existing = record.events.findIndex((event) => event.id === next.id);
		record.events = existing < 0
			? [...record.events, next]
			: record.events.map((event, index) => index === existing ? next : event);
	}
	const cutoff = feed.items.reduce(
		(oldest, item) => Math.min(oldest, milliseconds(item.renewal.blockTime)),
		Number.POSITIVE_INFINITY,
	);
	for (const record of records.values()) {
		record.events = record.events.filter((event) =>
			event.kind !== "renewal"
			|| received.has(event.id)
			|| (feed.nextCursor !== null && event.at < cutoff),
		);
	}
}
export function syncLeaderboard(leaderboard: LeaderboardRead): void { for (const name of leaderboard.items) setName(name); }
export function syncName(activity: NameActivityRead): NameRecord { return setName(activity.name, activity); }
export function allNames(): NameRecord[] { return [...records.values()]; }
export function findName(query: string): NameRecord | undefined { const label = query.trim().replace(/\.eth$/i, "").toLowerCase(); return records.get(label); }
export function nameExpiry(record: NameRecord): number { return record.onchain?.expiry ?? 0; }
export function timeDelivered(record: NameRecord): bigint { return record.timeDeliveredSeconds; }
export function totalReceived(record: NameRecord): bigint { return record.lifetimeReceived; }
export function renewalCount(record: NameRecord): bigint { return record.renewalCount; }
export function recentActivity(limit = 40): Array<ActivityEvent & { name: string }> { return allNames().flatMap((record) => record.events.filter((event) => event.kind === "renewal").map((event) => ({ ...event, name: record.name }))).sort((a, b) => b.at - a.at).slice(0, limit); }
export function activeFlows(): Array<{ id: string; name: string; chain: string; amount: bigint; status: FlowStatus; seconds: bigint; off: string; startedAt: number }> { return allNames().flatMap((record) => record.pending.flows.map((flow) => ({ id: flow.id, name: record.name, chain: flow.chain, amount: flow.amount, status: flow.status, seconds: 0n, off: "", startedAt: flow.startedAt }))).sort((a, b) => b.startedAt - a.startedAt); }
export function hasActiveFlow(record: NameRecord): boolean { return record.flows.some((flow) => !["settled", "cancelled", "failed"].includes(flow.status)); }
export function canTrigger(pending: PendingState, balance: ChainBalance): boolean {
	const minimum = minTrigger(balance.chainId);
	return minimum !== undefined && balance.amount !== null && pending.renewable && balance.amount >= minimum && ["not_detected", "flow_failed"].includes(balance.holdReason);
}
export function totalHeld(pending: PendingState): bigint { return pending.balances.reduce((total, balance) => total + (balance.amount ?? 0n), 0n); }
export function totalInFlight(pending: PendingState): bigint { return pending.flows.reduce((total, flow) => total + flow.amount, 0n); }
