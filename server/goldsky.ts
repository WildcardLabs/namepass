import { indexedRenewalExpiry } from "./indexed-renewal";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { normalizeLabel } from "../src/lib/namepass";
import { readNativeUsdcBalances } from "./chain";
import { minimumTriggerAmount } from "./config";
import { database } from "./db/client";
import { chainEvents, deposits, flows, flowTransitions, names, transactionIntents } from "./db/schema";
import { cctpFlowRowsLockSql, cctpIdentityLockSql, hasCctpSourceEvidence } from "./cctp-identity";
import { ApiError, handler, json } from "./http";
import { readGoldskyBody, decodeGoldskyBody } from "./goldsky-body";
import { logOperation, logWarning } from "./log";
import { startRenewalWorkflow } from "./workflows";
import { rawPayloadExpiresAt } from "./retention";
import {
	assertCctpSettlementPair,
	settlementBundleForEnsEvent,
	settlementBundleForEvent,
	type SettlementIdentityEvent,
} from "./settlement-identity";
import { STOPPED_DEPOSIT_ERROR, stoppedFlowReason } from "./stopped-flows";
import { ORIGIN_WALLET_ACTIVE_STATUSES } from "./flow-state";
import { originWalletLockSql, requestBalanceScanSql } from "./balance-scan";
import { depositWasAbsorbed } from "./deposit-eligibility";
import {
	transactionHashMatchesIntentSql,
} from "./transactions";

const COMMON_FIELDS = [
	"event_id",
	"event_family",
	"event_type",
	"chain_id",
	"block_number",
	"block_time",
	"tx_hash",
	"log_index",
	"_gs_op",
] as const;

const EVENT_FIELDS = {
	"deposit:Transfer": ["token_address", "sender_address", "recipient_address", "amount"],
	"namepass:WalletDeployed": ["contract_address", "label_key", "wallet_address", "label"],
	"namepass:DepositProcessed": [
		"contract_address",
		"label_key",
		"wallet_address",
		"amount",
		"remaining_amount",
	],
	"namepass:CCTPClaimed": [
		"contract_address",
		"nonce",
		"wallet_address",
		"source_domain",
		"burn_amount",
		"fee_executed",
		"minted_amount",
	],
	"namepass:Renewed": [
		"contract_address",
		"label_hash",
		"wallet_address",
		"executor_address",
		"label",
		"duration",
		"amount_received",
		"gas_allowance",
		"amount_applied",
		"remainder",
		"from_cctp",
	],
	"ens:NameRenewed": [
		"contract_address",
		"token_id",
		"label",
		"duration",
		"new_expiry",
		"payment_token",
		"referrer",
		"amount",
	],
} as const;

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;

type EventKey = keyof typeof EVENT_FIELDS;
type EventFamily = "deposit" | "namepass" | "ens";
type GoldskyOperation = "c" | "d";

export interface GoldskyEvent {
	payload: Record<string, unknown>;
	facts: Record<string, unknown>;
	eventId: string;
	eventFamily: EventFamily;
	eventType: string;
	chainId: number;
	blockNumber: string;
	blockTime: Date;
	txHash: string;
	logIndex: number;
	gsOp: GoldskyOperation;
	transferKind?: "native" | "erc20";
	tokenAddress?: string;
	senderAddress?: string;
	recipientAddress?: string;
	amount?: string;
}

export interface GoldskyTransaction {
	upsertEvent(event: GoldskyEvent): Promise<void>;
	lockSettlementTransaction(event: GoldskyEvent): Promise<void>;
	nameIdForAddress(address: string): Promise<string | undefined>;
	upsertDeposit(event: GoldskyEvent, nameId: string): Promise<void>;
	reconcileOriginBurn(event: GoldskyEvent): Promise<string | undefined>;
	reconcileRenewal(event: GoldskyEvent): Promise<string | undefined>;
	refreshRenewalAggregates(nameId: string, invalidated?: boolean): Promise<void>;
	refreshEnsExpiry(event: GoldskyEvent): Promise<void>;
	ensureFlow(nameId: string, chainId: number, amount: string, depositEventId: string | null): Promise<string | undefined>;
	markChainForScan(nameId: string, chainId: number, requestedThroughBlock?: string): Promise<void>;
	cancelUnbroadcastFlow(nameId: string, chainId: number, depositEventId: string): Promise<void>;
}

export interface GoldskyStore {
	transaction<T>(work: (tx: GoldskyTransaction) => Promise<T>): Promise<T>;
}

export function externalRenewalProjection(
	facts: Record<string, unknown>,
	claim?: Record<string, unknown>,
) {
	const fromCctp = facts.from_cctp === "true";
	if (fromCctp && !claim) return undefined;
	const origin = fromCctp
		? SERVER_CHAINS.find((chain) => String(chain.circleDomain) === String(claim!.source_domain))
		: HUB_CHAIN;
	if (!origin) return undefined;
	return {
		originChainId: String(origin.chainId),
		amountDetected: String(fromCctp ? claim!.burn_amount : facts.amount_received),
		amountProcessed: String(fromCctp ? claim!.burn_amount : facts.amount_received),
		remainingAmount: String(facts.remainder),
		gasAllowance: String(facts.gas_allowance),
		amountApplied: String(facts.amount_applied),
		durationSeconds: String(facts.duration),
		cctpNonce: claim ? BigInt(String(claim.nonce)).toString() : null,
	};
}

/** Settlement fields that may move to an existing evidence-rich source flow. */
export function externalSettlementPatch(
	projection: NonNullable<ReturnType<typeof externalRenewalProjection>>,
	renewalEventId: string,
	settledAt: Date,
	expiryAfter: Date | null,
) {
	return {
		renewalEventId,
		status: "settled" as const,
		amountProcessed: projection.amountProcessed,
		gasAllowance: projection.gasAllowance,
		amountApplied: projection.amountApplied,
		durationSeconds: projection.durationSeconds,
		cctpNonce: projection.cctpNonce,
		...(expiryAfter ? { expiryAfter } : {}),
		workflowRunId: null,
		settledAt,
	};
}

export function reorgResumeStatus(kind: "origin_renew" | "claim") {
	return kind === "claim" ? "waiting_claim" as const : "waiting_origin" as const;
}

/** Origin evidence may advance an early flow, but it cannot rewind a later CCTP stage. */
export function originBurnReconciliationStatus(status: typeof flows.$inferSelect.status) {
	return ORIGIN_WALLET_ACTIVE_STATUSES.includes(status) ? "waiting_origin" as const : status;
}

function ensExpiry(facts: unknown): Date | null {
	if (!facts || typeof facts !== "object") return null;
	const value = String((facts as Record<string, unknown>).new_expiry ?? "");
	if (!/^\d+$/.test(value)) return null;
	const milliseconds = BigInt(value) * 1_000n;
	if (milliseconds > 8_640_000_000_000_000n) return null;
	return new Date(Number(milliseconds));
}

export function ensExpiryProjection(
	eventFacts: unknown,
	previousFacts: unknown | undefined,
	deleted: boolean,
): { label: string; expiry: Date | null } | undefined {
	const label = ensRenewalLabel(eventFacts);
	if (!label) return undefined;
	const expiry = deleted
		? previousFacts === undefined ? null : ensExpiry(previousFacts)
		: ensExpiry(eventFacts);
	return deleted || expiry ? { label, expiry } : undefined;
}

export function ensRenewalLabel(facts: unknown): string | undefined {
	if (!facts || typeof facts !== "object") return undefined;
	const label = (facts as Record<string, unknown>).label;
	if (typeof label !== "string") return undefined;
	try {
		const normalized = normalizeLabel(label);
		return normalized === label ? normalized : undefined;
	} catch {
		return undefined;
	}
}

function invalid(field: string): never {
	throw new ApiError(400, "invalid_goldsky_event", `Invalid Goldsky field: ${field}.`);
}

function stringField(object: Record<string, unknown>, key: string, max: number): string {
	const value = object[key];
	if (typeof value !== "string" || !value || value.length > max) invalid(key);
	return value;
}

function integerField(object: Record<string, unknown>, key: string): number {
	const value = object[key];
	if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(key);
	return Number(value);
}

function patternField(
	object: Record<string, unknown>,
	key: string,
	pattern: RegExp,
	max = 512,
): string {
	const value = stringField(object, key, max).toLowerCase();
	if (!pattern.test(value)) invalid(key);
	return value;
}

function decimalField(object: Record<string, unknown>, key: string): string {
	return patternField(object, key, DECIMAL, 78);
}

/**
 * A bytes32 value from a decoded event parameter. Goldsky's `_gs_log_decode`
 * returns addresses with a `0x` prefix but bytes32 values as bare 64-hex, so
 * accept either and normalize to `0x`-prefixed lowercase — the form that
 * `names.labelHash` and `BigInt(nonce)` both require.
 */
function hashField(object: Record<string, unknown>, key: string): string {
	const value = stringField(object, key, 66).toLowerCase().replace(/^0x/, "");
	if (!/^[0-9a-f]{64}$/.test(value)) invalid(key);
	return `0x${value}`;
}

function blockTimeField(object: Record<string, unknown>): Date {
	const value = object.block_time;
	const date =
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0
			? new Date(value < 100_000_000_000 ? value * 1_000 : value)
			: typeof value === "string" &&
				  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
				? new Date(value)
				: invalid("block_time");
	if (!Number.isFinite(date.getTime())) invalid("block_time");
	return date;
}

function assertExactFields(object: Record<string, unknown>, key: EventKey): void {
	const expected = new Set<string>([...COMMON_FIELDS, ...EVENT_FIELDS[key]]);
	if (Object.keys(object).length !== expected.size) invalid("object");
	for (const field of expected) if (!(field in object)) invalid(field);
}

function assertAllowlisted(
	key: EventKey,
	object: Record<string, unknown>,
	chain: (typeof SERVER_CHAINS)[number],
): void {
	if (key === "deposit:Transfer") {
		if (patternField(object, "token_address", ADDRESS) !== chain.usdcAddress.toLowerCase()) {
			invalid("token_address");
		}
		return;
	}

	const contract = patternField(object, "contract_address", ADDRESS);
	if (key === "namepass:WalletDeployed" || key === "namepass:DepositProcessed") {
		if (contract !== chain.factoryAddress?.toLowerCase()) invalid("contract_address");
	} else if (key === "namepass:CCTPClaimed" || key === "namepass:Renewed") {
		if (contract !== chain.gatewayAddress?.toLowerCase()) invalid("contract_address");
	} else if (
		contract !== chain.ensRegistrarAddress?.toLowerCase() &&
		contract !== chain.ensRenewerV1Address?.toLowerCase()
	) {
		invalid("contract_address");
	}
}

export function parseGoldskyEvent(object: Record<string, unknown>): GoldskyEvent {
	const eventFamily = stringField(object, "event_family", 16) as EventFamily;
	const eventType = stringField(object, "event_type", 64);
	const key = `${eventFamily}:${eventType}` as EventKey;
	if (!(key in EVENT_FIELDS)) invalid("event_type");
	assertExactFields(object, key);

	const chainId = integerField(object, "chain_id");
	const chain = SERVER_CHAINS.find((candidate) => candidate.chainId === chainId);
	if (!chain) invalid("chain_id");
	assertAllowlisted(key, object, chain);

	const gsOp = stringField(object, "_gs_op", 1);
	if (gsOp !== "c" && gsOp !== "i" && gsOp !== "d") invalid("_gs_op");

	const parsed: GoldskyEvent = {
		payload: object,
		facts: Object.fromEntries(EVENT_FIELDS[key].map((field) => [field, object[field]])),
		eventId: stringField(object, "event_id", 512),
		eventFamily,
		eventType,
		chainId,
		blockNumber: String(integerField(object, "block_number")),
		blockTime: blockTimeField(object),
		txHash: patternField(object, "tx_hash", HASH),
		logIndex: integerField(object, "log_index"),
		gsOp: gsOp === "i" ? "c" : gsOp,
	};
	if (!parsed.eventId.startsWith(`${chainId}:`)) invalid("event_id");
	if (eventFamily === "deposit") {
		parsed.transferKind = parsed.eventId.startsWith(`${chainId}:native:`) ? "native" : "erc20";
	}

	if (key === "deposit:Transfer") {
		parsed.tokenAddress = patternField(object, "token_address", ADDRESS);
		parsed.senderAddress = patternField(object, "sender_address", ADDRESS);
		parsed.recipientAddress = patternField(object, "recipient_address", ADDRESS);
		parsed.amount = decimalField(object, "amount");
	} else if (key === "namepass:WalletDeployed") {
		parsed.facts.label_key = hashField(object, "label_key");
		patternField(object, "wallet_address", ADDRESS);
		stringField(object, "label", 255);
	} else if (key === "namepass:DepositProcessed") {
		parsed.facts.label_key = hashField(object, "label_key");
		patternField(object, "wallet_address", ADDRESS);
		decimalField(object, "amount");
		decimalField(object, "remaining_amount");
	} else if (key === "namepass:CCTPClaimed") {
		parsed.facts.nonce = hashField(object, "nonce");
		patternField(object, "wallet_address", ADDRESS);
		const sourceDomain = decimalField(object, "source_domain");
		if (
			!SERVER_CHAINS.some(
				(candidate) =>
					candidate.tokenMessengerAddress && String(candidate.circleDomain) === sourceDomain,
			)
		) {
			invalid("source_domain");
		}
		decimalField(object, "burn_amount");
		decimalField(object, "fee_executed");
		decimalField(object, "minted_amount");
	} else if (key === "namepass:Renewed") {
		parsed.facts.label_hash = hashField(object, "label_hash");
		patternField(object, "wallet_address", ADDRESS);
		patternField(object, "executor_address", ADDRESS);
		stringField(object, "label", 255);
		for (const field of ["duration", "amount_received", "gas_allowance", "amount_applied", "remainder"])
			decimalField(object, field);
		if (!new Set(["true", "false"]).has(stringField(object, "from_cctp", 5))) invalid("from_cctp");
	} else {
		decimalField(object, "token_id");
		stringField(object, "label", 255);
		decimalField(object, "duration");
		decimalField(object, "new_expiry");
		if (patternField(object, "payment_token", ADDRESS) !== chain.usdcAddress.toLowerCase()) {
			invalid("payment_token");
		}
		parsed.facts.referrer = hashField(object, "referrer");
		decimalField(object, "amount");
	}
	return parsed;
}

export async function ingestGoldskyEvent(
	store: GoldskyStore,
	event: GoldskyEvent,
	observedBalance?: string,
	balanceReadFailed = false,
): Promise<string | undefined> {
	return store.transaction(async (tx) => {
		await tx.upsertEvent(event);
		if (
			(event.eventFamily === "namepass"
				&& (event.eventType === "Renewed" || event.eventType === "CCTPClaimed"))
			|| (event.eventFamily === "ens" && event.eventType === "NameRenewed")
		) {
			/* Each handler stores its event before it waits. The handler that gets
			   this lock second can then see the first committed bundle member. */
			await tx.lockSettlementTransaction(event);
		}
		if (event.eventFamily === "namepass" && event.eventType === "DepositProcessed") {
			return tx.reconcileOriginBurn(event);
		}
		if (
			event.eventFamily === "namepass"
			&& (event.eventType === "Renewed" || event.eventType === "CCTPClaimed")
		) {
			const nameId = await tx.reconcileRenewal(event);
			if (nameId) await tx.refreshRenewalAggregates(nameId, event.gsOp === "d");
			return undefined;
		}
		if (event.eventFamily === "ens" && event.eventType === "NameRenewed") {
			await tx.refreshEnsExpiry(event);
			return undefined;
		}
		if (event.eventFamily !== "deposit") return undefined;
		const { recipientAddress, amount } = event;
		if (!recipientAddress || amount === undefined) throw new Error("Deposit fields are missing.");
		const nameId = await tx.nameIdForAddress(recipientAddress);
		if (!nameId) {
			throw new ApiError(503, "watched_address_missing", "The watched address is not available.");
		}
		await tx.upsertDeposit(event, nameId);
		if (event.gsOp === "d") {
			await tx.cancelUnbroadcastFlow(nameId, event.chainId, event.eventId);
			return undefined;
		}
		if (balanceReadFailed) await tx.markChainForScan(nameId, event.chainId, event.blockNumber);
		const eventAmount = BigInt(amount);
		const balance = observedBalance === undefined ? eventAmount : BigInt(observedBalance);
		const amountDetected = balance > eventAmount ? balance : eventAmount;
		return amountDetected >= minimumTriggerAmount(event.chainId)
			? tx.ensureFlow(
				nameId,
				event.chainId,
				amountDetected.toString(),
				amountDetected === eventAmount ? event.eventId : null,
			)
			: undefined;
	});
}

function equalSecret(provided: string, expected: string): boolean {
	const providedBytes = Buffer.from(provided);
	const expectedBytes = Buffer.from(expected);
	const length = Math.max(providedBytes.length, expectedBytes.length, 1);
	const left = Buffer.alloc(length);
	const right = Buffer.alloc(length);
	providedBytes.copy(left);
	expectedBytes.copy(right);
	const equal = timingSafeEqual(left, right);
	return providedBytes.length === expectedBytes.length && equal;
}

export async function startGoldskyFlow(flowId: string): Promise<void> {
	try {
		await startRenewalWorkflow(flowId);
	} catch {
		logOperation("goldsky.workflow_start_failed", {
			flowId,
			step: "workflow_start",
			errorCode: "workflow_start_failed",
		});
		throw new ApiError(503, "workflow_unavailable", "The renewal workflow is not available.");
	}
}

export function goldskyHandler(
	store: GoldskyStore = postgresGoldskyStore,
	startFlow: (flowId: string) => Promise<void> = startGoldskyFlow,
	secret: () => string | undefined = () => process.env.GOLDSKY_WEBHOOK_SECRET,
	readBalance: (address: string, chainId: number) => Promise<string | undefined> = async (address, chainId) =>
		(await readNativeUsdcBalances(address, [chainId]))[0]?.amount,
	readRenewalExpiry: (event: GoldskyEvent) => Promise<string> = indexedRenewalExpiry,
) {
	return handler("POST", async (request) => {
		const expected = secret();
		if (!expected) {
			throw new ApiError(503, "webhook_unconfigured", "The webhook is not configured.");
		}
		if (!equalSecret(request.headers.get("authorization") ?? "", expected)) {
			throw new ApiError(401, "invalid_webhook_auth", "The webhook authorization is invalid.");
		}
		const body = await readGoldskyBody(request);
		let object: Record<string, unknown> = {};
		let event: GoldskyEvent;
		try {
			if (body.truncated) throw new ApiError(413, "body_too_large", "The request body is too large.");
			object = decodeGoldskyBody(body.bytes);
			event = parseGoldskyEvent(object);
		} catch (error) {
			logWarning("goldsky.rejected_payload", {
				chainId: Number.isSafeInteger(object.chain_id) ? Number(object.chain_id) : undefined,
				step: "payload_validation",
				errorCode: error instanceof ApiError ? error.code : "parse_error",
				eventId: typeof object.event_id === "string" && /^\d{1,10}:[a-zA-Z0-9:_-]{1,480}$/.test(object.event_id)
					? object.event_id
					: undefined,
				blockNumber: Number.isSafeInteger(object.block_number)
					? Number(object.block_number)
					: undefined,
				payloadHash: createHash("sha256").update(body.bytes).digest("hex"),
				payloadHashScope: body.truncated ? "first_8192_bytes" : "complete_body",
				receivedAt: new Date().toISOString(),
			});
			return json({ accepted: false, skipped: true }, 200);
		}
		if (event.eventFamily === "namepass" && event.eventType === "Renewed" && event.gsOp === "c") {
			event.facts.new_expiry = await readRenewalExpiry(event);
		}
		let observedBalance: string | undefined;
		let balanceReadFailed = false;
		if (
			event.eventFamily === "deposit"
			&& event.gsOp === "c"
			&& event.recipientAddress
			&& event.amount !== undefined
			&& BigInt(event.amount) < minimumTriggerAmount(event.chainId)
		) {
			try {
				observedBalance = await readBalance(event.recipientAddress, event.chainId);
			} catch {
				balanceReadFailed = true;
				logOperation("goldsky.balance_unavailable", {
					chainId: event.chainId,
					step: "balance_read",
					errorCode: "rpc_unavailable",
					eventId: event.eventId,
				});
			}
		}
		if (process.env.NAMEPASS_INTEGRATIONS_ENABLED === "1" && event.eventFamily === "deposit") {
			await (await import("./integrations/coverage")).normalizeIndexedDeposit(event);
		}
		const flowId = await ingestGoldskyEvent(store, event, observedBalance, balanceReadFailed);
		if (flowId) await startFlow(flowId);
		if (process.env.NAMEPASS_INTEGRATIONS_ENABLED === "1") {
			try { await (await import("./integrations/wake")).wakeIntegrations(); } catch { /* Cron repairs the durable wake. */ }
		}
		return json({ accepted: true });
	});
}

export const postgresGoldskyStore: GoldskyStore = {
	transaction: (work) =>
		database().transaction(async (tx) =>
			work({
				async upsertEvent(event) {
					if (event.eventFamily === "deposit" || event.eventFamily === "namepass" || event.eventFamily === "ens") {
						const native = event.transferKind === "native";
						await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`event-identity:${event.chainId}:${event.txHash}:${event.eventType}:${native ? "native" : event.logIndex}`},0))`);
						const existing = await tx.select({ eventId: chainEvents.eventId }).from(chainEvents).where(and(
							eq(chainEvents.chainId, String(event.chainId)), eq(chainEvents.txHash, event.txHash),
							eq(chainEvents.eventFamily, event.eventFamily), eq(chainEvents.eventType, event.eventType), eq(chainEvents.evidenceKind, native ? "native" : "log"),
							native ? undefined : eq(chainEvents.logIndex, event.logIndex),
						));
						if (existing.length > 1) throw new Error("A transfer has conflicting canonical identities.");
						if (existing[0]) event.eventId = existing[0].eventId;
					}
					const now = new Date();
					await tx
						.insert(chainEvents)
						.values({
							eventId: event.eventId,
							eventFamily: event.eventFamily,
							eventType: event.eventType,
							chainId: String(event.chainId),
							txHash: event.txHash,
							logIndex: event.logIndex,
							evidenceKind: event.transferKind === "native" ? "native" : "log",
							blockNumber: event.blockNumber,
							blockTime: event.blockTime,
							gsOp: event.gsOp,
							canonical: event.gsOp === "c",
							facts: event.facts,
							payload: event.payload,
							payloadExpiresAt: rawPayloadExpiresAt(now),
							lastSeenAt: now,
						})
						.onConflictDoUpdate({
							target: chainEvents.eventId,
							set: {
								gsOp: event.gsOp,
								blockNumber: event.blockNumber,
								blockTime: event.blockTime,
								logIndex: event.logIndex,
								canonical: event.gsOp === "c",
								facts: event.facts,
								payload: event.payload,
								payloadExpiresAt: rawPayloadExpiresAt(now),
								lastSeenAt: now,
							},
							});
					},
					async lockSettlementTransaction(event) {
						await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
							${`goldsky-settlement:${event.chainId}:${event.txHash}`},
							0
						))`);
					},
					async nameIdForAddress(address) {
					return (await tx.select({ id: names.id }).from(names).where(eq(names.depositAddress, address)))[0]?.id;
				},
				async upsertDeposit(event, nameId) {
					if (!event.tokenAddress || !event.recipientAddress || event.amount === undefined) {
						throw new Error("Deposit fields are missing.");
					}
					await tx
						.insert(deposits)
						.values({
							eventId: event.eventId,
							nameId,
							chainId: String(event.chainId),
							tokenAddress: event.tokenAddress,
							transferKind: event.transferKind ?? "erc20",
							senderAddress: event.senderAddress,
							amount: event.amount,
							txHash: event.txHash,
							logIndex: event.logIndex,
							blockNumber: event.blockNumber,
							blockTime: event.blockTime,
							source: "goldsky",
							status: event.gsOp === "c" ? "detected" : "orphaned",
						})
						.onConflictDoUpdate({
							target: deposits.eventId,
							set: {
								status: event.gsOp === "c" ? "detected" : "orphaned", logIndex: event.logIndex,
								blockNumber: event.blockNumber, blockTime: event.blockTime, amount: event.amount,
								senderAddress: event.senderAddress, transferKind: event.transferKind ?? "erc20",
							},
						});
				},
				async reconcileOriginBurn(event) {
					const facts = event.facts as Record<string, unknown>;
					const wallet = String(facts.wallet_address ?? "");
					const [name] = await tx.select({ id: names.id }).from(names).where(eq(names.depositAddress, wallet));
					if (!name) return undefined;
					const originChainId = String(event.chainId);
					await tx.execute(originWalletLockSql(name.id, originChainId));
					const now = new Date();
					const eventOwners = await tx.select({
						id: flows.id,
						nameId: flows.nameId,
						originChainId: flows.originChainId,
						status: flows.status,
						trigger: flows.trigger,
						originIntentId: flows.originTxIntentId,
						claimIntentId: flows.claimTxIntentId,
						renewalEventId: flows.renewalEventId,
						cctpNonce: flows.cctpNonce,
						cctpAttestation: flows.cctpAttestation,
						originEventId: flows.originEventId,
					}).from(flows).where(eq(flows.originEventId, event.eventId));
					if (eventOwners.length > 1) throw new Error("One origin event is linked to multiple flows.");
					if (eventOwners[0] && (
						eventOwners[0].nameId !== name.id
						|| eventOwners[0].originChainId !== originChainId
					)) {
						throw new Error("The origin event owner does not match the event route.");
					}
					const intentOwners = eventOwners.length ? [] : await tx.select({
						id: flows.id,
						nameId: flows.nameId,
						originChainId: flows.originChainId,
						status: flows.status,
						trigger: flows.trigger,
						originIntentId: flows.originTxIntentId,
						claimIntentId: flows.claimTxIntentId,
						renewalEventId: flows.renewalEventId,
						cctpNonce: flows.cctpNonce,
						cctpAttestation: flows.cctpAttestation,
						originEventId: flows.originEventId,
					}).from(flows)
						.innerJoin(transactionIntents, eq(transactionIntents.id, flows.originTxIntentId))
						.where(and(
							eq(flows.nameId, name.id),
							eq(flows.originChainId, originChainId),
							eq(transactionIntents.kind, "origin_renew"),
							transactionHashMatchesIntentSql(event.txHash),
						));
					if (intentOwners.length > 1) throw new Error("One origin transaction matches multiple flows.");
					let owner = eventOwners[0] ?? intentOwners[0];
					if (!owner) {
						const legacyOwners = await tx.select({ id: flows.id }).from(flows).where(and(
							eq(flows.nameId, name.id),
							eq(flows.originChainId, originChainId),
							isNull(flows.originEventId),
							isNull(flows.originTxIntentId),
							eq(flows.originEvidenceTxHash, event.txHash),
						));
						if (legacyOwners.length) {
							throw new Error("A legacy origin flow needs exact event identity before replay.");
						}
					}

					if (event.chainId === HUB_CHAIN.chainId) {
						if (!owner) return undefined;
						await tx.execute(cctpFlowRowsLockSql([owner.id]));
						const [lockedOwner] = await tx.select({
							status: flows.status,
							nameId: flows.nameId,
							originChainId: flows.originChainId,
							originEventId: flows.originEventId,
						}).from(flows).where(eq(flows.id, owner.id));
						if (
							!lockedOwner
							|| lockedOwner.nameId !== name.id
							|| lockedOwner.originChainId !== originChainId
							|| (event.gsOp === "d" && lockedOwner.originEventId !== event.eventId)
							|| (event.gsOp === "c" && lockedOwner.originEventId !== null
								&& lockedOwner.originEventId !== event.eventId)
						) {
							throw new Error("The Ethereum origin flow changed before reconciliation.");
						}
						await tx.update(flows).set(event.gsOp === "d" ? {
							originEventId: null,
							originEvidenceTxHash: null,
							originEvidenceBlockNumber: null,
							amountProcessed: null,
							remainingAmount: null,
							updatedAt: now,
						} : {
							originEventId: event.eventId,
							originEvidenceTxHash: event.txHash,
							originEvidenceBlockNumber: event.blockNumber,
							amountProcessed: String(facts.amount),
							remainingAmount: String(facts.remaining_amount),
							updatedAt: now,
						}).where(and(eq(flows.id, owner.id), eq(flows.status, lockedOwner.status)));
						if (event.gsOp === "d") {
							await this.markChainForScan(name.id, event.chainId);
						}
						if (event.gsOp !== "d" && BigInt(String(facts.remaining_amount)) > 0n) {
							await this.markChainForScan(name.id, event.chainId, event.blockNumber);
						}
						return undefined;
					}

					if (event.gsOp === "d") {
						if (!owner) return undefined;
						const [renewalBeforeLock] = owner.renewalEventId
							? await tx.select({ canonical: chainEvents.canonical })
								.from(chainEvents).where(eq(chainEvents.eventId, owner.renewalEventId))
							: [];
						if (renewalBeforeLock?.canonical) {
							throw new Error("A canonical settlement conflicts with the deleted origin event.");
						}
						if (owner.cctpNonce) {
							await tx.execute(cctpIdentityLockSql(owner.originChainId, owner.cctpNonce));
						}
						await tx.execute(sql`select id from flows where id = ${owner.id} for update`);
						const [lockedOwner] = await tx.select({
							status: flows.status,
							originIntentId: flows.originTxIntentId,
							renewalEventId: flows.renewalEventId,
							cctpNonce: flows.cctpNonce,
							claimIntentId: flows.claimTxIntentId,
							cctpAttestation: flows.cctpAttestation,
							originEventId: flows.originEventId,
						}).from(flows).where(eq(flows.id, owner.id));
						if (
							!lockedOwner
							|| lockedOwner.originEventId !== event.eventId
							|| lockedOwner.cctpNonce !== owner.cctpNonce
							|| lockedOwner.renewalEventId !== owner.renewalEventId
						) {
							throw new Error("The origin flow changed while its event was removed.");
						}
						if (lockedOwner.originIntentId && (lockedOwner.claimIntentId || lockedOwner.cctpAttestation)) {
							throw new Error("A final CCTP claim conflicts with the deleted origin event.");
						}
						const hasOriginIntent = lockedOwner.originIntentId !== null;
						if (hasOriginIntent) {
							await tx.update(transactionIntents).set({
								status: "broadcast",
								confirmedAt: null,
								receipt: null,
								updatedAt: now,
							}).where(and(
								eq(transactionIntents.id, lockedOwner.originIntentId!),
								eq(transactionIntents.kind, "origin_renew"),
								inArray(transactionIntents.status, ["broadcast", "mined", "confirmed"]),
							));
						}
						const status = hasOriginIntent ? "waiting_origin" as const : "cancelled" as const;
						await tx.update(flows).set({
							status,
							...(hasOriginIntent ? { originEventId: null } : {}),
							originEvidenceTxHash: null,
							originEvidenceBlockNumber: null,
							amountProcessed: null,
							remainingAmount: null,
							cctpMessageIndex: null,
							cctpMessage: null,
							cctpNonce: null,
							cctpAttestation: null,
							workflowRunId: null,
							lastErrorCode: "origin_reorged",
							nextActionAt: hasOriginIntent ? now : null,
							cancelledAt: hasOriginIntent ? null : now,
							updatedAt: now,
						}).where(and(eq(flows.id, owner.id), eq(flows.status, lockedOwner.status)));
						await tx.insert(flowTransitions).values({
							flowId: owner.id,
							fromStatus: lockedOwner.status,
							toStatus: status,
							actor: "webhook",
							reasonCode: "origin_reorged",
						});
						await this.markChainForScan(name.id, event.chainId);
						return hasOriginIntent ? owner.id : undefined;
					}

					if (owner) {
						if (owner.cctpNonce) {
							await tx.execute(cctpIdentityLockSql(owner.originChainId, owner.cctpNonce));
						}
						await tx.execute(cctpFlowRowsLockSql([owner.id]));
						const [lockedOwner] = await tx.select({
							id: flows.id,
							nameId: flows.nameId,
							originChainId: flows.originChainId,
							status: flows.status,
							trigger: flows.trigger,
							originIntentId: flows.originTxIntentId,
							claimIntentId: flows.claimTxIntentId,
							renewalEventId: flows.renewalEventId,
							cctpNonce: flows.cctpNonce,
							cctpAttestation: flows.cctpAttestation,
							originEventId: flows.originEventId,
						}).from(flows).where(eq(flows.id, owner.id));
						if (
							!lockedOwner
							|| lockedOwner.nameId !== name.id
							|| lockedOwner.originChainId !== originChainId
							|| (lockedOwner.originEventId !== null
								&& lockedOwner.originEventId !== event.eventId)
						) {
							throw new Error("The origin flow changed before reconciliation.");
						}
						owner = lockedOwner;
					}

					if (!owner) {
						const [active] = await tx.select({
							id: flows.id,
							nameId: flows.nameId,
							originChainId: flows.originChainId,
							status: flows.status,
							trigger: flows.trigger,
							originIntentId: flows.originTxIntentId,
							claimIntentId: flows.claimTxIntentId,
							renewalEventId: flows.renewalEventId,
							cctpNonce: flows.cctpNonce,
							cctpAttestation: flows.cctpAttestation,
							originEventId: flows.originEventId,
						}).from(flows).where(and(
							eq(flows.nameId, name.id),
							eq(flows.originChainId, originChainId),
							isNull(flows.originEventId),
							isNull(flows.originTxIntentId),
							inArray(flows.status, ORIGIN_WALLET_ACTIVE_STATUSES),
						)).for("update");
						owner = active;
					}

					const nextStatus = owner ? originBurnReconciliationStatus(owner.status) : "waiting_origin" as const;
					const restoresExternal = owner?.status === "cancelled" && owner.originIntentId === null;
					const values = {
						originEventId: event.eventId,
						originEvidenceTxHash: event.txHash,
						originEvidenceBlockNumber: event.blockNumber,
						status: restoresExternal ? "waiting_origin" as const : nextStatus,
						amountProcessed: String(facts.amount),
						remainingAmount: String(facts.remaining_amount),
						waitingOriginAt: event.blockTime,
						...(restoresExternal ? { cancelledAt: null, lastErrorCode: null } : {}),
						updatedAt: now,
					};
					const [flow] = owner
						? await tx.update(flows).set(values).where(and(
							eq(flows.id, owner.id),
							eq(flows.status, owner.status),
						)).returning({ id: flows.id })
						: await tx.insert(flows).values({
							...values,
							nameId: name.id,
							originChainId,
							trigger: "external",
							amountDetected: String(facts.amount),
						}).returning({ id: flows.id });
					if (!flow) return undefined;
					if (BigInt(String(facts.remaining_amount)) > 0n) {
						await this.markChainForScan(name.id, event.chainId, event.blockNumber);
					}
					if (!owner || owner.status !== values.status) {
						await tx.insert(flowTransitions).values({
							flowId: flow.id,
							fromStatus: owner?.status ?? null,
							toStatus: values.status,
							actor: "webhook",
							reasonCode: "origin_burn_observed",
						});
					}
					return flow.id;
				},
				async reconcileRenewal(event) {
					const transactionEvents = await tx.select({
						eventId: chainEvents.eventId,
						eventFamily: chainEvents.eventFamily,
						eventType: chainEvents.eventType,
						logIndex: chainEvents.logIndex,
						canonical: chainEvents.canonical,
						facts: chainEvents.facts,
					}).from(chainEvents).where(and(
						eq(chainEvents.chainId, String(event.chainId)),
						eq(chainEvents.txHash, event.txHash),
					));
					const bundle = settlementBundleForEvent(
						transactionEvents as SettlementIdentityEvent[],
						event.eventId,
					);
					if (!bundle) return undefined;
					const renewal = {
						...bundle.renewal,
						txHash: event.txHash,
						blockTime: event.blockTime,
					};
					const facts = renewal.facts as Record<string, unknown>;
					const wallet = String(facts.wallet_address ?? "");
					const [name] = await tx.select({
						id: names.id,
						labelHash: names.labelHash,
						normalizedLabel: names.normalizedLabel,
					}).from(names).where(eq(names.depositAddress, wallet));
					if (!name) return undefined;
					if (
						String(facts.label_hash ?? "").toLowerCase() !== name.labelHash.toLowerCase()
						|| String(facts.label ?? "") !== name.normalizedLabel
					) {
						throw new Error("The exact renewal event does not match the activated name.");
					}
					const fromCctp = facts.from_cctp === "true";
					if (fromCctp && !bundle.claim) return name.id;
					assertCctpSettlementPair(bundle);
					const expiryAfter = bundle.ensRenewal?.canonical
						? ensExpiry(bundle.ensRenewal.facts)
						: ensExpiry(facts);
					const expiryPatch = expiryAfter ? { expiryAfter } : {};

					if (!renewal.canonical || (bundle.claim !== undefined && !bundle.claim.canonical)) {
						const affected = await tx.select({
							flowId: flows.id,
							originChainId: flows.originChainId,
							status: flows.status,
							trigger: flows.trigger,
							cctpMessage: flows.cctpMessage,
							cctpNonce: flows.cctpNonce,
							originEventId: flows.originEventId,
							originEvidenceTxHash: flows.originEvidenceTxHash,
							renewalEventId: flows.renewalEventId,
						}).from(flows).where(eq(flows.renewalEventId, renewal.eventId));
						const now = new Date();
						for (const snapshot of affected) {
							if (snapshot.cctpNonce) {
								await tx.execute(cctpIdentityLockSql(snapshot.originChainId, snapshot.cctpNonce));
							}
							/* The Iris merge can move `renewalEventId` while this transaction
							   waits for the identity lock. Resolve the owner again after the
							   wait, then lock that row. */
							const [ownerAfterLock] = await tx.select({
								flowId: flows.id,
								originChainId: flows.originChainId,
								cctpNonce: flows.cctpNonce,
							}).from(flows).where(eq(flows.renewalEventId, renewal.eventId));
							if (!ownerAfterLock) continue;
							if (snapshot.cctpNonce && (
								ownerAfterLock.originChainId !== snapshot.originChainId
								|| ownerAfterLock.cctpNonce !== snapshot.cctpNonce
							)) {
								throw new Error("The settlement identity changed while its event was removed.");
							}
							await tx.execute(cctpFlowRowsLockSql([ownerAfterLock.flowId]));
							const [row] = await tx.select({
								flowId: flows.id,
								originChainId: flows.originChainId,
								status: flows.status,
								trigger: flows.trigger,
								cctpMessage: flows.cctpMessage,
								cctpNonce: flows.cctpNonce,
								originEventId: flows.originEventId,
								originEvidenceTxHash: flows.originEvidenceTxHash,
								renewalEventId: flows.renewalEventId,
							}).from(flows).where(eq(flows.id, ownerAfterLock.flowId));
							if (!row || row.renewalEventId !== renewal.eventId) continue;
							const [matchingIntent] = await tx.select({
								id: transactionIntents.id,
								kind: transactionIntents.kind,
								status: transactionIntents.status,
							})
								.from(transactionIntents).where(and(
									eq(transactionIntents.flowId, row.flowId),
									transactionHashMatchesIntentSql(renewal.txHash),
								));
							const [claimIntent] = matchingIntent ? [] : await tx.select({
								id: transactionIntents.id,
								kind: transactionIntents.kind,
								status: transactionIntents.status,
							})
								.from(transactionIntents).where(and(
									eq(transactionIntents.flowId, row.flowId),
									eq(transactionIntents.kind, "claim"),
								));
							const recoverable = row.trigger !== "external"
								|| row.cctpMessage !== null
								|| row.originEventId !== null
								|| row.originEvidenceTxHash !== null;
							if (!recoverable) {
								await tx.update(flows).set({
									status: "cancelled",
									expiryAfter: null,
									cctpNonce: null,
									workflowRunId: null,
									lastErrorCode: "settlement_reorged",
									nextActionAt: null,
									cancelledAt: now,
									updatedAt: now,
								})
									.where(eq(flows.id, row.flowId));
								if (row.status !== "cancelled") {
									await tx.insert(flowTransitions).values({
										flowId: row.flowId,
										fromStatus: row.status,
										toStatus: "cancelled",
										actor: "webhook",
										reasonCode: "settlement_reorged",
									});
								}
								continue;
							}
							const intent = matchingIntent ?? claimIntent;
							const status = intent?.status === "reverted"
								? intent.kind === "claim" ? "unclaimed" as const : "queued" as const
								: intent ? reorgResumeStatus(intent.kind)
									: row.cctpMessage ? "submitting_claim" as const : "waiting_origin" as const;
							if (matchingIntent) {
								await tx.update(transactionIntents).set({
									status: "broadcast",
									confirmedAt: null,
									receipt: null,
									updatedAt: now,
								}).where(and(
									eq(transactionIntents.id, matchingIntent.id),
									inArray(transactionIntents.status, ["mined", "confirmed"]),
								));
							}
							await tx.update(flows).set({
								renewalEventId: null,
								status,
								gasAllowance: null,
								amountApplied: null,
								durationSeconds: null,
								expiryAfter: null,
								settledAt: null,
								workflowRunId: null,
								lastErrorCode: "settlement_reorged",
								nextActionAt: now,
								updatedAt: now,
							}).where(eq(flows.id, row.flowId));
							await tx.insert(flowTransitions).values({
								flowId: row.flowId,
								fromStatus: row.status,
								toStatus: status,
								actor: "webhook",
								reasonCode: "settlement_reorged",
							});
						}
						return name.id;
					}

					const knownRows = await tx
						.select({
							id: flows.id,
							status: flows.status,
							nameId: flows.nameId,
							originChainId: flows.originChainId,
							remainingAmount: flows.remainingAmount,
							cctpNonce: flows.cctpNonce,
							originEvidenceTxHash: flows.originEvidenceTxHash,
							intentId: transactionIntents.id,
							intentKind: transactionIntents.kind,
						})
						.from(flows)
						.innerJoin(transactionIntents, eq(transactionIntents.flowId, flows.id))
						.where(and(
							eq(flows.nameId, name.id),
							ne(flows.status, "cancelled"),
							transactionHashMatchesIntentSql(renewal.txHash),
						));
					if (knownRows.length > 1) {
						throw new Error("One renewal transaction matches multiple flows.");
					}
					const known = knownRows[0];
					if (known) {
						const now = new Date();
						if (known.cctpNonce) {
							await tx.execute(cctpIdentityLockSql(known.originChainId, known.cctpNonce));
						}
						await tx.execute(cctpFlowRowsLockSql([known.id]));
						const [current] = await tx.select({
							status: flows.status,
							cctpNonce: flows.cctpNonce,
							remainingAmount: flows.remainingAmount,
						}).from(flows).where(eq(flows.id, known.id));
						if (!current || current.cctpNonce !== known.cctpNonce) {
							throw new Error("The renewal flow changed while its event was reconciled.");
						}
						if (current.status === "cancelled" || current.status === "failed") {
							throw new Error("A canonical renewal conflicts with a terminal flow.");
						}
						const [lockedIntent] = await tx.select({ id: transactionIntents.id })
							.from(transactionIntents)
							.where(and(
								eq(transactionIntents.id, known.intentId),
								transactionHashMatchesIntentSql(renewal.txHash),
							))
							.for("update");
						if (!lockedIntent) throw new Error("The renewal intent changed before reconciliation.");
						await tx.update(transactionIntents).set({
							status: "confirmed",
							confirmedAt: renewal.blockTime,
							updatedAt: now,
						}).where(eq(transactionIntents.id, known.intentId));
						await tx.update(flows).set({
							renewalEventId: renewal.eventId,
							...(known.intentKind === "origin_renew" ? {
								originEvidenceTxHash: renewal.txHash,
								originEvidenceBlockNumber: event.blockNumber,
							} : {}),
							status: "settled",
							gasAllowance: String(facts.gas_allowance),
							amountApplied: String(facts.amount_applied),
							durationSeconds: String(facts.duration),
							...expiryPatch,
							holdReason: null,
							lastErrorCode: null,
							nextActionAt: null,
							workflowRunId: null,
							settledAt: renewal.blockTime,
							updatedAt: now,
						})
							.where(eq(flows.id, known.id));
						if (current.status !== "settled") {
							await tx.insert(flowTransitions).values({
								flowId: known.id,
								fromStatus: current.status,
								toStatus: "settled",
								actor: "webhook",
								reasonCode: "canonical_renewal_observed",
							});
						}
						// `Renewed.remainder` is pricing dust. Keep the origin wallet remainder
						// that `DepositProcessed` stored, and mark only this chain for a balance scan.
						if (BigInt(current.remainingAmount ?? "0") > 0n) {
							await tx.execute(requestBalanceScanSql({
								nameId: known.nameId,
								chainId: known.originChainId,
							}));
							await tx.update(names).set({
								unscannedChainIds: sql`case
									when ${known.originChainId}::numeric = any(${names.unscannedChainIds})
									then ${names.unscannedChainIds}
									else array_append(${names.unscannedChainIds}, ${known.originChainId}::numeric)
								end`,
							}).where(eq(names.id, known.nameId));
						}
						return name.id;
					}

					let claim: Record<string, unknown> | undefined;
					if (fromCctp) {
						claim = bundle.claim?.canonical ? bundle.claim.facts : undefined;
						if (!claim) return name.id;
					}

					const projection = externalRenewalProjection(facts, claim);
					if (!projection) return name.id;
					const values = {
						nameId: name.id,
						renewalEventId: renewal.eventId,
						trigger: "external" as const,
						status: "settled" as const,
						...projection,
						...expiryPatch,
						settledAt: renewal.blockTime,
					};
					const settlementPatch = externalSettlementPatch(
						projection,
						renewal.eventId,
						renewal.blockTime,
						expiryAfter,
					);
					if (projection.cctpNonce) {
						const now = new Date();
						await tx.execute(cctpIdentityLockSql(projection.originChainId, projection.cctpNonce));
						const [eventOwner] = await tx.select().from(flows)
							.where(eq(flows.renewalEventId, renewal.eventId));
						const owners = await tx.select().from(flows).where(and(
							eq(flows.originChainId, projection.originChainId),
							eq(flows.cctpNonce, projection.cctpNonce),
						));
						if (owners.length > 1) throw new Error("One Circle message is linked to multiple active flows.");
						const owner = owners[0];
						if (owner) {
							if (
								owner.nameId !== name.id
								|| owner.originChainId !== projection.originChainId
								|| (owner.amountProcessed !== null
									&& owner.amountProcessed !== projection.amountProcessed)
							) {
								throw new Error("The Circle message owner does not match the settlement event.");
							}
							const idsToLock = [...new Set([owner.id, ...(eventOwner ? [eventOwner.id] : [])])];
							await tx.execute(cctpFlowRowsLockSql(idsToLock));
							const [lockedOwner] = await tx.select({
								status: flows.status,
								nameId: flows.nameId,
								originChainId: flows.originChainId,
								cctpNonce: flows.cctpNonce,
								amountProcessed: flows.amountProcessed,
							}).from(flows).where(eq(flows.id, owner.id));
							if (
								!lockedOwner
								|| lockedOwner.nameId !== name.id
								|| lockedOwner.originChainId !== projection.originChainId
								|| lockedOwner.cctpNonce !== projection.cctpNonce
								|| (lockedOwner.amountProcessed !== null
									&& lockedOwner.amountProcessed !== projection.amountProcessed)
							) {
								throw new Error("The Circle message owner changed before settlement.");
							}
							if (lockedOwner.status === "cancelled" || lockedOwner.status === "failed") {
								throw new Error("A canonical renewal conflicts with a terminal Circle message owner.");
							}
							if (eventOwner && eventOwner.id !== owner.id) {
								await tx.update(flows).set({ renewalEventId: null, updatedAt: now })
									.where(and(
										eq(flows.id, eventOwner.id),
										eq(flows.renewalEventId, renewal.eventId),
									));
							}
							await tx.update(flows).set({
								...settlementPatch,
								holdReason: null,
								lastErrorCode: null,
								lastErrorDetail: null,
								nextActionAt: null,
								cancelledAt: null,
								updatedAt: now,
							}).where(and(eq(flows.id, owner.id), eq(flows.status, lockedOwner.status)));
							if (lockedOwner.status !== "settled") {
								await tx.insert(flowTransitions).values({
									flowId: owner.id,
									fromStatus: lockedOwner.status,
									toStatus: "settled",
									actor: "webhook",
									reasonCode: "canonical_renewal_observed",
								});
							}
							return name.id;
						}
						if (eventOwner) {
							if (eventOwner.nameId !== name.id) {
								throw new Error("The renewal event owner does not match the settlement event.");
							}
							await tx.execute(cctpFlowRowsLockSql([eventOwner.id]));
							const [lockedEventOwner] = await tx.select().from(flows)
								.where(eq(flows.id, eventOwner.id));
							if (
								!lockedEventOwner
								|| lockedEventOwner.renewalEventId !== renewal.eventId
								|| lockedEventOwner.nameId !== name.id
								|| lockedEventOwner.trigger !== "external"
								|| lockedEventOwner.claimTxIntentId !== null
								|| hasCctpSourceEvidence(lockedEventOwner)
							) {
								throw new Error("The renewal event owner is not a bare external projection.");
							}
							await tx.update(flows).set({
								...values,
								cancelledAt: null,
								lastErrorCode: null,
								updatedAt: now,
							}).where(and(
								eq(flows.id, eventOwner.id),
								eq(flows.renewalEventId, renewal.eventId),
							));
							return name.id;
						}
						await tx.insert(flows).values(values).onConflictDoNothing();
						return name.id;
					}
					const [existing] = await tx.select().from(flows)
						.where(eq(flows.renewalEventId, renewal.eventId));
					if (existing) {
						await tx.execute(cctpFlowRowsLockSql([existing.id]));
						const [lockedExisting] = await tx.select().from(flows).where(eq(flows.id, existing.id));
						if (
							!lockedExisting
							|| lockedExisting.renewalEventId !== renewal.eventId
							|| lockedExisting.nameId !== name.id
							|| lockedExisting.trigger !== "external"
							|| lockedExisting.originTxIntentId !== null
							|| lockedExisting.claimTxIntentId !== null
							|| hasCctpSourceEvidence(lockedExisting)
						) {
							throw new Error("The renewal event conflicts with a non-external flow.");
						}
						await tx.update(flows).set({ ...values, status: "settled", cancelledAt: null, updatedAt: new Date() })
							.where(and(eq(flows.id, existing.id), eq(flows.renewalEventId, renewal.eventId)));
					} else {
						await tx.insert(flows).values(values).onConflictDoNothing();
					}
					return name.id;
				},
				async refreshRenewalAggregates(nameId, invalidated = false) {
					await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`renewal-aggregate:${nameId}`}, 0))`);
					const isRenewedForName = sql`${chainEvents.canonical} = true
						and ${chainEvents.eventFamily} = 'namepass'
						and ${chainEvents.eventType} = 'Renewed'
						and lower(${chainEvents.facts}->>'label_hash') = lower(${names.labelHash})`;
					await tx
						.update(names)
						.set({
							lifetimeReceived: sql`coalesce((select sum((${chainEvents.facts}->>'amount_received')::numeric) from ${chainEvents} where ${isRenewedForName}), 0)`,
							lifetimeApplied: sql`coalesce((select sum((${chainEvents.facts}->>'amount_applied')::numeric) from ${chainEvents} where ${isRenewedForName}), 0)`,
							timeDeliveredSeconds: sql`coalesce((select sum((${chainEvents.facts}->>'duration')::numeric) from ${chainEvents} where ${isRenewedForName}), 0)`,
							renewalCount: sql`(select count(*) from ${chainEvents} where ${isRenewedForName})`,
							currentExpiry: invalidated
								? sql`(select to_timestamp(max((${chainEvents.facts}->>'new_expiry')::numeric)) from ${chainEvents} where ${isRenewedForName})`
								: sql`greatest(${names.currentExpiry}, (select to_timestamp(max((${chainEvents.facts}->>'new_expiry')::numeric)) from ${chainEvents} where ${isRenewedForName}))`,
						})
						.where(eq(names.id, nameId));
				},
				async refreshEnsExpiry(event) {
					// Serialize projections for one name across different settlement transactions.
					await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ens-expiry:${event.chainId}:${String(event.facts.label).toLowerCase()}`}, 0))`);
					const transactionEvents = await tx.select({
						eventId: chainEvents.eventId,
						eventFamily: chainEvents.eventFamily,
						eventType: chainEvents.eventType,
						logIndex: chainEvents.logIndex,
						canonical: chainEvents.canonical,
						facts: chainEvents.facts,
					}).from(chainEvents).where(and(
						eq(chainEvents.chainId, String(event.chainId)),
						eq(chainEvents.txHash, event.txHash),
					));
					const bundle = settlementBundleForEnsEvent(
						transactionEvents as SettlementIdentityEvent[],
						event.eventId,
					);
					if (bundle?.renewal.canonical) {
						await tx.update(flows).set({
							expiryAfter: event.gsOp === "d" ? null : ensExpiry(event.facts),
							updatedAt: new Date(),
						}).where(eq(flows.renewalEventId, bundle.renewal.eventId));
					}
					let previousFacts: unknown;
					if (event.gsOp === "d") {
						const [previous] = await tx.select({ facts: chainEvents.facts })
							.from(chainEvents)
							.where(and(
								eq(chainEvents.canonical, true),
								eq(chainEvents.eventFamily, "ens"),
								eq(chainEvents.eventType, "NameRenewed"),
								sql`lower(${chainEvents.facts}->>'label') = lower(${String(event.facts.label)})`,
							))
							.orderBy(sql`${chainEvents.blockNumber} desc`, sql`${chainEvents.logIndex} desc`, sql`${chainEvents.eventId} desc`)
							.limit(1);
						previousFacts = previous?.facts;
					}
					const projection = ensExpiryProjection(event.facts, previousFacts, event.gsOp === "d");
					if (!projection) return;
					const aggregate = event.gsOp === "d"
						? {
							currentExpiry: projection.expiry,
							ensSyncedAt: sql<Date>`greatest(${names.ensSyncedAt}, ${event.blockTime})`,
						}
						: {
							currentExpiry: sql<Date>`greatest(coalesce(${names.currentExpiry}, ${projection.expiry}), ${projection.expiry})`,
							ensSyncedAt: sql<Date>`greatest(${names.ensSyncedAt}, ${event.blockTime})`,
						};
					await tx.update(names).set(aggregate)
						.where(eq(names.normalizedLabel, projection.label));
				},
				async markChainForScan(nameId, chainId, requestedThroughBlock) {
					await tx.execute(requestBalanceScanSql({ nameId, chainId, requestedThroughBlock }));
					await tx.update(names).set({
						unscannedChainIds: sql`case
							when ${String(chainId)}::numeric = any(${names.unscannedChainIds})
							then ${names.unscannedChainIds}
							else array_append(${names.unscannedChainIds}, ${String(chainId)}::numeric)
						end`,
					}).where(eq(names.id, nameId));
				},
				async ensureFlow(nameId, chainId, amount, depositEventId) {
					await tx.execute(originWalletLockSql(nameId, chainId));
					if (depositEventId) {
						const [deposit] = await tx.select({ blockNumber: deposits.blockNumber })
							.from(deposits)
							.where(eq(deposits.eventId, depositEventId));
						if (deposit) {
							const priorOrigins = await tx.select({
								id: flows.id,
								originBlock: flows.originEvidenceBlockNumber,
								remainingAmount: flows.remainingAmount,
							}).from(flows).where(and(
								eq(flows.nameId, nameId),
								eq(flows.originChainId, String(chainId)),
								isNotNull(flows.originEvidenceTxHash),
								isNotNull(flows.originEvidenceBlockNumber),
								gt(flows.originEvidenceBlockNumber, deposit.blockNumber),
							));
							const absorbed = priorOrigins.find((origin) =>
								origin.originBlock !== null
								&& origin.remainingAmount !== null
								&& depositWasAbsorbed({
									depositBlock: BigInt(deposit.blockNumber),
									originBlock: BigInt(origin.originBlock),
									remainingAmount: BigInt(origin.remainingAmount),
								}));
							if (absorbed) {
								const [ghost] = await tx.select({ id: flows.id, status: flows.status })
									.from(flows)
									.where(and(
										eq(flows.depositEventId, depositEventId),
										isNull(flows.originTxIntentId),
										inArray(flows.status, ["queued", "confirming_deposit", "checking_name", "held"]),
									));
								if (ghost) {
									const now = new Date();
									const [cancelled] = await tx.update(flows).set({
										status: "cancelled",
										holdReason: null,
										workflowRunId: null,
										lastErrorCode: "absorbed_by_prior_flow",
										lastErrorDetail: null,
										nextActionAt: null,
										cancelledAt: now,
										updatedAt: now,
									}).where(and(eq(flows.id, ghost.id), eq(flows.status, ghost.status)))
										.returning({ id: flows.id });
									if (cancelled) {
										await tx.insert(flowTransitions).values({
											flowId: ghost.id,
											fromStatus: ghost.status,
											toStatus: "cancelled",
											actor: "webhook",
											reasonCode: "absorbed_by_prior_flow",
											detail: { consumingFlowId: absorbed.id },
										});
									}
								}
								return undefined;
							}
						}
					}
					const [created] = await tx
						.insert(flows)
						.values({
							nameId,
							depositEventId,
							originChainId: String(chainId),
							trigger: "automatic",
							status: "queued",
							amountDetected: amount,
						})
						.onConflictDoNothing()
						.returning({ id: flows.id });
					if (created) return created.id;
					if (depositEventId) {
						const [linked] = await tx.select({
							flow: flows,
							reasonCode: stoppedFlowReason(),
						}).from(flows).where(eq(flows.depositEventId, depositEventId));
						if (linked) {
							const [active] = await tx.select({ id: flows.id }).from(flows).where(and(
								eq(flows.nameId, nameId),
								eq(flows.originChainId, String(chainId)),
								isNull(flows.originEventId),
								inArray(flows.status, ORIGIN_WALLET_ACTIVE_STATUSES),
							));
							if (active) return active.id;
							const safeToResume = [STOPPED_DEPOSIT_ERROR, "deposit_orphaned"].includes(linked.reasonCode ?? "")
								&& ["cancelled", "failed"].includes(linked.flow.status)
								&& linked.flow.originTxIntentId === null
								&& linked.flow.renewalEventId === null;
							if (safeToResume) {
								const now = new Date();
								await tx.update(flows).set({
									status: "queued",
									holdReason: null,
									lastErrorCode: null,
									lastErrorDetail: null,
									nextActionAt: null,
									queuedAt: now,
									cancelledAt: null,
									failedAt: null,
									updatedAt: now,
								}).where(eq(flows.id, linked.flow.id));
								await tx.insert(flowTransitions).values({
									flowId: linked.flow.id,
									fromStatus: linked.flow.status,
									toStatus: "queued",
									actor: "webhook",
									reasonCode: "duplicate_deposit_resume",
								});
							}
							return linked.flow.id;
						}
					}
					const [existing] = await tx
						.select({ id: flows.id })
						.from(flows)
							.where(
								and(
									eq(flows.nameId, nameId),
									eq(flows.originChainId, String(chainId)),
									isNull(flows.originEventId),
									inArray(flows.status, ORIGIN_WALLET_ACTIVE_STATUSES),
								),
						);
					if (!existing) throw new Error("Active flow conflict did not return a flow.");
					await tx.update(flows).set({
						depositEventId: null,
						holdReason: "multiple_or_unlinked_deposits",
						updatedAt: new Date(),
					}).where(eq(flows.id, existing.id));
					const [triggerDeposit] = depositEventId
						? await tx.select({ blockNumber: deposits.blockNumber })
							.from(deposits).where(eq(deposits.eventId, depositEventId))
						: [];
					await this.markChainForScan(nameId, chainId, triggerDeposit?.blockNumber);
					return existing.id;
				},
				async cancelUnbroadcastFlow(nameId, chainId, depositEventId) {
					const cancelled = await tx
						.update(flows)
						.set({ status: "cancelled", lastErrorCode: "deposit_orphaned", cancelledAt: new Date(), updatedAt: new Date() })
						.where(
							and(
								eq(flows.nameId, nameId),
								eq(flows.originChainId, String(chainId)),
								eq(flows.depositEventId, depositEventId),
								isNull(flows.originTxIntentId),
								inArray(flows.status, ["queued", "confirming_deposit", "checking_name", "held"]),
							),
						)
						.returning({ id: flows.id });
					for (const flow of cancelled) {
						await tx.insert(flowTransitions).values({
							flowId: flow.id,
							toStatus: "cancelled",
							actor: "webhook",
							reasonCode: "deposit_orphaned",
						});
					}
				},
			}),
		),
};

/** Project canonical renewals that arrived before a name was activated. */
export async function reconcileStoredRenewals(walletAddress: string): Promise<void> {
	const stored = await database()
		.select()
		.from(chainEvents)
		.where(
			and(
				eq(chainEvents.canonical, true),
				eq(chainEvents.eventFamily, "namepass"),
				eq(chainEvents.eventType, "Renewed"),
				sql`lower(${chainEvents.facts}->>'wallet_address') = lower(${walletAddress})`,
			),
		);
	for (const row of stored) {
		await postgresGoldskyStore.transaction(async (tx) => {
			const nameId = await tx.reconcileRenewal({
				payload: {},
				facts: row.facts as Record<string, unknown>,
				eventId: row.eventId,
				eventFamily: "namepass",
				eventType: "Renewed",
				chainId: Number(row.chainId),
				blockNumber: row.blockNumber,
				blockTime: row.blockTime,
				txHash: row.txHash,
				logIndex: row.logIndex,
				gsOp: "c",
			});
			if (nameId) await tx.refreshRenewalAggregates(nameId);
		});
	}
}
