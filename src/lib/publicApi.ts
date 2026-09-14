/** Browser read models. Monetary values stay as decimal strings until a view formats them. */

import type { PublicConfigRead } from "./triggerConfig";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class PublicApiError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
		this.name = "PublicApiError";
	}
}

import type { FlowStatus } from "./flowTypes";
export type { FlowStatus } from "./flowTypes";

export interface PublicName {
	label: string;
	displayName: string;
	depositAddress: string;
	activatedAt: string;
	currentExpiry: string | null;
	renewableBy: "registrar" | "v1" | null;
	ensSyncedAt: string;
	unscannedChainIds: string[];
	lifetimeReceived: string;
	lifetimeApplied: string;
	timeDeliveredSeconds: string;
	renewalCount: string;
}

export interface FlowEvidence {
	depositTxHash: string | null;
	originTxHash: string | null;
	claimTxHash: string | null;
	renewalTxHash: string | null;
	executorAddress: string | null;
	executorIsRelayer: boolean;
}

export interface PublicFlow {
	id: string;
	originChainId: string;
	trigger: "automatic" | "manual" | "recovery" | "external";
	status: FlowStatus;
	holdReason: string | null;
	amountDetected: string;
	amountProcessed: string | null;
	remainingAmount: string | null;
	gasAllowance: string | null;
	amountApplied: string | null;
	durationSeconds: string | null;
	cctpNonce: string | null;
	lastErrorCode: string | null;
	nextActionAt: string | null;
	queuedAt: string;
	confirmingDepositAt: string | null;
	checkingNameAt: string | null;
	submittingOriginAt: string | null;
	waitingOriginAt: string | null;
	waitingAttestationAt: string | null;
	submittingClaimAt: string | null;
	waitingClaimAt: string | null;
	heldAt: string | null;
	unclaimedAt: string | null;
	settledAt: string | null;
	cancelledAt: string | null;
	failedAt: string | null;
	createdAt: string;
	updatedAt: string;
	/** Added by Phase 4 read models. It is never inferred from the sender. */
	evidence?: FlowEvidence;
}

export interface PublicRenewal {
	eventId: string;
	flowId: string;
	originChainId: string;
	funderAddress: string | null;
	funderUnavailableReason?: "multiple_deposits" | "deposit_not_linked" | null;
	executorAddress: string;
	executorIsRelayer: boolean;
	amountReceived: string;
	gasAllowance: string;
	amountApplied: string;
	durationSeconds: string;
	expiryAfter: string | null;
	fromCctp: boolean;
	depositTxHash: string | null;
	originTxHash: string | null;
	claimTxHash: string | null;
	renewalTxHash: string;
	blockTime: string;
}

/** A null amount means the indexed chain snapshot is unavailable or inconsistent. It never means zero. */
export interface PublicChainBalance {
	chainId: string;
	amount: string | null;
}

export interface NameRead {
	name: PublicName;
	activeFlows: PublicFlow[];
	balances: PublicChainBalance[];
}

export interface NameActivityRead {
	name: PublicName;
	renewals: PublicRenewal[];
	flows: PublicFlow[];
	balances: PublicChainBalance[];
	nextCursor: string | null;
	page?: number;
	pageSize?: number;
	totalItems?: number;
	totalPages?: number;
}

export interface ActivityRead {
	items: Array<{ name: PublicName; renewal: PublicRenewal }>;
	flows: Array<{ name: PublicName; flow: PublicFlow }>;
	nextCursor: string | null;
	page?: number;
	pageSize?: number;
	totalItems?: number;
	totalPages?: number;
}

export interface LeaderboardRead {
	items: PublicName[];
}

type ApiErrorBody = { error?: { message?: unknown } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		cache: "no-store",
		headers: { accept: "application/json", ...init?.headers },
	});
	const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
	if (!response.ok) {
		const message =
			body && typeof body === "object" && "error" in body && typeof body.error?.message === "string"
				? body.error.message
				: "The request failed.";
		throw new PublicApiError(response.status, message);
	}
	return body as T;
}

function labelPath(label: string): string {
	return encodeURIComponent(label.replace(/\.eth$/i, ""));
}

export function getName(label: string): Promise<NameRead> {
	return request(`/api/names/${labelPath(label)}`);
}

export function getNameActivity(label: string, page = 1, limit = 30): Promise<NameActivityRead> {
	const query = new URLSearchParams({ page: String(page), limit: String(limit) });
	return request(`/api/names/${labelPath(label)}/activity?${query}`);
}

export function getActivity(page = 1, limit = 15): Promise<ActivityRead> {
	const query = new URLSearchParams({ page: String(page), limit: String(limit) });
	return request(`/api/activity?${query}`);
}

export function getLeaderboard(): Promise<LeaderboardRead> {
	return request("/api/leaderboard?limit=100");
}

export function getPublicConfig(): Promise<PublicConfigRead> {
	return request("/api/config/public");
}

export function activateName(name: string): Promise<{ name: PublicName; activated: boolean }> {
	return request("/api/names/activate", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name }),
	});
}

/** The endpoint is idempotent. A resumed queued flow returns the existing flow ID. */
export function triggerFlow(name: string, chainId: string): Promise<{ flowId: string; status: FlowStatus }> {
	const parsedChainId = safeInteger(chainId);
	if (parsedChainId === undefined || parsedChainId < 1) {
		throw new Error("chainId must be a positive safe integer.");
	}
	return request("/api/flows/trigger", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name, chainId: parsedChainId }),
	});
}

export function micro(value: string | null | undefined): bigint {
	return value ? BigInt(value) : 0n;
}

export function milliseconds(value: string | null | undefined): number {
	return value ? new Date(value).getTime() : 0;
}

/** Convert API integer text only after proving that JavaScript can represent it exactly. */
export function safeInteger(value: string): number | undefined {
	if (!/^\d+$/.test(value)) return undefined;
	const integer = BigInt(value);
	return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : undefined;
}

export async function fetchMonitoring(days: number, signal?: AbortSignal, filters: { page: number; chain: string; search: string; status: string } = {page: 1, chain: "all", search: "", status: "all"}): Promise<import("./monitoring").MonitorRead> {
 const params = new URLSearchParams({days: String(days), page: String(filters.page), search: filters.search, status: filters.status});
 if (filters.chain !== "all") params.set("chain", filters.chain);
 const response = await fetch(`${API_BASE}/api/monitoring?${params}`, { signal });
 if (!response.ok) throw new PublicApiError(response.status, "Monitoring data could not be loaded.");
 return response.json();
}
export async function fetchMonitoringGas(): Promise<import("./monitoring").GasRead> {
 const response = await fetch(`${API_BASE}/api/monitoring/gas`);
 if (!response.ok) throw new PublicApiError(response.status, "Relayer balances could not be loaded.");
 return response.json();
}
