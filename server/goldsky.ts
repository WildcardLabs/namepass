import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";
import { normalizeLabel } from "../src/lib/namepass";
import { minimumTriggerAmount } from "./config";
import { database } from "./db/client";
import { chainEvents, deposits, flows, names, transactionIntents } from "./db/schema";
import { ApiError, handler, json, readObject } from "./http";
import { logOperation } from "./log";
import { startRenewalWorkflow } from "./workflows";
import { rawPayloadExpiresAt } from "./retention";

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

const ALL_FIELDS = [...new Set([...COMMON_FIELDS, ...Object.values(EVENT_FIELDS).flat()])];
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
	tokenAddress?: string;
	senderAddress?: string;
	recipientAddress?: string;
	amount?: string;
}

export interface GoldskyTransaction {
	upsertEvent(event: GoldskyEvent): Promise<void>;
	nameIdForAddress(address: string): Promise<string | undefined>;
	upsertDeposit(event: GoldskyEvent, nameId: string): Promise<void>;
	refreshDepositAggregates(nameId: string): Promise<void>;
	reconcileRenewal(event: GoldskyEvent): Promise<string | undefined>;
	refreshRenewalAggregates(nameId: string): Promise<void>;
	refreshEnsExpiry(event: GoldskyEvent): Promise<void>;
	ensureFlow(nameId: string, chainId: number, amount: string, depositEventId: string): Promise<string>;
	cancelUnbroadcastFlow(nameId: string, chainId: number): Promise<void>;
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
		amountDetected: String(facts.amount_received),
		amountProcessed: String(facts.amount_received),
		remainingAmount: String(facts.remainder),
		gasAllowance: String(facts.gas_allowance),
		amountApplied: String(facts.amount_applied),
		durationSeconds: String(facts.duration),
		cctpNonce: claim ? BigInt(String(claim.nonce)).toString() : null,
	};
}

function ensExpiry(facts: unknown): Date | null {
	if (!facts || typeof facts !== "object") return null;
	const value = String((facts as Record<string, unknown>).new_expiry ?? "");
	if (!/^\d+$/.test(value)) return null;
	const milliseconds = BigInt(value) * 1_000n;
	if (milliseconds > 8_640_000_000_000_000n) return null;
	return new Date(Number(milliseconds));
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
		if (contract !== chain.helperAddress?.toLowerCase()) invalid("contract_address");
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
): Promise<string | undefined> {
	return store.transaction(async (tx) => {
		await tx.upsertEvent(event);
		if (
			event.eventFamily === "namepass"
			&& (event.eventType === "Renewed" || event.eventType === "CCTPClaimed")
		) {
			const nameId = await tx.reconcileRenewal(event);
			if (nameId) await tx.refreshRenewalAggregates(nameId);
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
		await tx.refreshDepositAggregates(nameId);
		if (event.gsOp === "d") {
			await tx.cancelUnbroadcastFlow(nameId, event.chainId);
			return undefined;
		}
		return BigInt(amount) >= minimumTriggerAmount(event.chainId)
			? tx.ensureFlow(nameId, event.chainId, amount, event.eventId)
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
) {
	return handler("POST", async (request) => {
		const expected = secret();
		if (!expected) {
			throw new ApiError(503, "webhook_unconfigured", "The webhook is not configured.");
		}
		if (!equalSecret(request.headers.get("authorization") ?? "", expected)) {
			throw new ApiError(401, "invalid_webhook_auth", "The webhook authorization is invalid.");
		}
		const object = await readObject(request, ALL_FIELDS);
		let event: GoldskyEvent;
		try {
			event = parseGoldskyEvent(object);
		} catch (error) {
			/* TEMPORARY testnet diagnostic. A rejected event must never return a
			   non-retriable 4xx: Goldsky treats that as fatal and crash-loops the whole
			   pipeline on the one bad row. Log the real payload shape so we can fix the
			   parser, then 200-ack so the indexer keeps moving. Remove the raw payload
			   log before mainnet. */
			console.info(JSON.stringify({
				event: "goldsky.rejected_payload",
				code: error instanceof ApiError ? error.code : "parse_error",
				message: error instanceof Error ? error.message : String(error),
				keys: Object.keys(object),
				payload: object,
			}));
			return json({ accepted: false, skipped: true }, 200);
		}
		const flowId = await ingestGoldskyEvent(store, event);
		if (flowId) await startFlow(flowId);
		return json({ accepted: true });
	});
}

export const postgresGoldskyStore: GoldskyStore = {
	transaction: (work) =>
		database().transaction(async (tx) =>
			work({
				async upsertEvent(event) {
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
								canonical: event.gsOp === "c",
								facts: event.facts,
								payload: event.payload,
								payloadExpiresAt: rawPayloadExpiresAt(now),
								lastSeenAt: now,
							},
						});
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
							set: { status: event.gsOp === "c" ? "detected" : "orphaned" },
						});
				},
				/* Build these rollups with the query builder, not a raw `set ${names.col}`
				   template. Postgres rejects a table-qualified SET target
				   (`set "names"."lifetime_received"`); the target column must be bare. */
				async refreshDepositAggregates(nameId) {
					await tx
						.update(names)
						.set({
							lifetimeReceived: sql`coalesce((
								select sum(${deposits.amount})
								from ${deposits}
								join ${chainEvents} on ${chainEvents.eventId} = ${deposits.eventId}
								where ${deposits.nameId} = ${nameId}
									and ${chainEvents.canonical} = true
									and ${deposits.status} in ('detected', 'finalized')
							), 0)`,
						})
						.where(eq(names.id, nameId));
				},
				async reconcileRenewal(event) {
					const [renewal] = event.eventType === "Renewed"
						? [{
							eventId: event.eventId,
							txHash: event.txHash,
							blockTime: event.blockTime,
							canonical: event.gsOp === "c",
							facts: event.facts,
						}]
						: await tx
							.select({
								eventId: chainEvents.eventId,
								txHash: chainEvents.txHash,
								blockTime: chainEvents.blockTime,
								canonical: chainEvents.canonical,
								facts: chainEvents.facts,
							})
							.from(chainEvents)
							.where(and(
								eq(chainEvents.txHash, event.txHash),
								eq(chainEvents.eventFamily, "namepass"),
								eq(chainEvents.eventType, "Renewed"),
							));
					if (!renewal) return undefined;
					const facts = renewal.facts as Record<string, unknown>;
					const wallet = String(facts.wallet_address ?? "");
					const [name] = await tx.select({ id: names.id }).from(names).where(eq(names.depositAddress, wallet));
					if (!name) return undefined;
					const [ensRenewal] = await tx.select({ facts: chainEvents.facts }).from(chainEvents).where(and(
						eq(chainEvents.txHash, renewal.txHash),
						eq(chainEvents.eventFamily, "ens"),
						eq(chainEvents.eventType, "NameRenewed"),
						eq(chainEvents.canonical, true),
					));
					const expiryAfter = ensExpiry(ensRenewal?.facts);
					const expiryPatch = expiryAfter ? { expiryAfter } : {};

					if (!renewal.canonical) {
						await tx.update(flows).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
							.where(and(eq(flows.renewalEventId, renewal.eventId), eq(flows.trigger, "external")));
						return name.id;
					}
					if (event.eventType === "CCTPClaimed" && event.gsOp === "d") {
						await tx.update(flows).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
							.where(and(eq(flows.renewalEventId, renewal.eventId), eq(flows.trigger, "external")));
						return name.id;
					}

					const [known] = await tx
						.select({ id: flows.id })
						.from(flows)
						.innerJoin(transactionIntents, eq(transactionIntents.flowId, flows.id))
						.where(and(
							eq(flows.nameId, name.id),
							eq(transactionIntents.currentTxHash, renewal.txHash),
						));
					if (known) {
						await tx.update(flows).set({
							renewalEventId: renewal.eventId,
							status: "settled",
							remainingAmount: String(facts.remainder),
							gasAllowance: String(facts.gas_allowance),
							amountApplied: String(facts.amount_applied),
							durationSeconds: String(facts.duration),
							...expiryPatch,
							settledAt: renewal.blockTime,
							updatedAt: new Date(),
						})
							.where(eq(flows.id, known.id));
						return name.id;
					}

					const fromCctp = facts.from_cctp === "true";
					let claim: Record<string, unknown> | undefined;
					if (fromCctp) {
						if (event.eventType === "CCTPClaimed") claim = event.facts;
						else {
							const [row] = await tx.select({ facts: chainEvents.facts }).from(chainEvents).where(and(
								eq(chainEvents.txHash, renewal.txHash),
								eq(chainEvents.eventFamily, "namepass"),
								eq(chainEvents.eventType, "CCTPClaimed"),
								eq(chainEvents.canonical, true),
							));
							claim = row?.facts as Record<string, unknown> | undefined;
						}
						if (!claim) return name.id;
					}

					const projection = externalRenewalProjection(facts, claim);
					if (!projection) return name.id;
					if (projection.cctpNonce) {
						const [rescued] = await tx.select({ id: flows.id }).from(flows).where(and(
							eq(flows.nameId, name.id),
							eq(flows.originChainId, projection.originChainId),
							eq(flows.cctpNonce, projection.cctpNonce),
						));
						if (rescued) {
							await tx.update(flows).set({
								renewalEventId: renewal.eventId,
								status: "settled",
								...projection,
								...expiryPatch,
								holdReason: null,
								lastErrorCode: null,
								nextActionAt: null,
								settledAt: renewal.blockTime,
								updatedAt: new Date(),
							}).where(eq(flows.id, rescued.id));
							return name.id;
						}
					}
					const values = {
						nameId: name.id,
						renewalEventId: renewal.eventId,
						trigger: "external" as const,
						status: "settled" as const,
						...projection,
						...expiryPatch,
						settledAt: renewal.blockTime,
					};
					const [existing] = await tx.select({ id: flows.id }).from(flows)
						.where(eq(flows.renewalEventId, renewal.eventId));
					if (existing) {
						await tx.update(flows).set({ ...values, status: "settled", cancelledAt: null, updatedAt: new Date() })
							.where(eq(flows.id, existing.id));
					} else {
						await tx.insert(flows).values(values).onConflictDoNothing();
					}
					return name.id;
				},
				async refreshRenewalAggregates(nameId) {
					const isRenewedForName = sql`${chainEvents.canonical} = true
						and ${chainEvents.eventFamily} = 'namepass'
						and ${chainEvents.eventType} = 'Renewed'
						and lower(${chainEvents.facts}->>'label_hash') = lower(${names.labelHash})`;
					await tx
						.update(names)
						.set({
							lifetimeApplied: sql`coalesce((select sum((${chainEvents.facts}->>'amount_applied')::numeric) from ${chainEvents} where ${isRenewedForName}), 0)`,
							timeDeliveredSeconds: sql`coalesce((select sum((${chainEvents.facts}->>'duration')::numeric) from ${chainEvents} where ${isRenewedForName}), 0)`,
							renewalCount: sql`(select count(*) from ${chainEvents} where ${isRenewedForName})`,
						})
						.where(eq(names.id, nameId));
				},
				async refreshEnsExpiry(event) {
					let facts = event.facts;
					if (event.gsOp === "d") {
						const [previous] = await tx.select({ facts: chainEvents.facts })
							.from(chainEvents)
							.where(and(
								eq(chainEvents.canonical, true),
								eq(chainEvents.eventFamily, "ens"),
								eq(chainEvents.eventType, "NameRenewed"),
								sql`lower(${chainEvents.facts}->>'label') = lower(${String(event.facts.label)})`,
							))
							.orderBy(sql`${chainEvents.blockTime} desc`)
							.limit(1);
						if (!previous) return;
						facts = previous.facts as Record<string, unknown>;
					}
					const expiry = ensExpiry(facts);
					if (!expiry) return;
					const label = ensRenewalLabel(facts);
					if (!label) return;
					const aggregate = event.gsOp === "d"
						? { currentExpiry: expiry, ensSyncedAt: event.blockTime }
						: {
							currentExpiry: sql<Date>`greatest(coalesce(${names.currentExpiry}, ${expiry}), ${expiry})`,
							ensSyncedAt: sql<Date>`greatest(${names.ensSyncedAt}, ${event.blockTime})`,
						};
					await tx.update(names).set(aggregate)
						.where(eq(names.normalizedLabel, label));
					const renewals = await tx.select({ eventId: chainEvents.eventId }).from(chainEvents).where(and(
						eq(chainEvents.txHash, event.txHash),
						eq(chainEvents.eventFamily, "namepass"),
						eq(chainEvents.eventType, "Renewed"),
						eq(chainEvents.canonical, true),
					));
					if (renewals.length) {
						await tx.update(flows).set({
							expiryAfter: event.gsOp === "d" ? null : expiry,
							updatedAt: new Date(),
						})
							.where(inArray(flows.renewalEventId, renewals.map((renewal) => renewal.eventId)));
					}
				},
				async ensureFlow(nameId, chainId, amount, depositEventId) {
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
					const [existing] = await tx
						.select({ id: flows.id })
						.from(flows)
						.where(
							and(
								eq(flows.nameId, nameId),
								eq(flows.originChainId, String(chainId)),
								notInArray(flows.status, ["settled", "cancelled", "failed"]),
							),
						);
					if (!existing) throw new Error("Active flow conflict did not return a flow.");
					return existing.id;
				},
				async cancelUnbroadcastFlow(nameId, chainId) {
					await tx
						.update(flows)
						.set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
						.where(
							and(
								eq(flows.nameId, nameId),
								eq(flows.originChainId, String(chainId)),
								isNull(flows.originTxIntentId),
								inArray(flows.status, ["queued", "confirming_deposit", "checking_name", "held"]),
							),
						);
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
