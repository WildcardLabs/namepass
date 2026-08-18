import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { database } from "./db/client";
import { chainEvents, deposits, flows, names, transactionIntents } from "./db/schema";
import { ApiError } from "./http";
import type { ActivityCursor } from "./http";
import { PUBLIC_CHAINS } from "../src/lib/chains";
import { checksumAddress } from "../src/lib/namepass";
import { CHAIN_TRIGGER_CONFIG, configuredRelayerAddress } from "./config";
import { readNativeUsdcBalances } from "./chain";

const PUBLIC_CACHE = { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" };
const LIVE_FLOW_STATUSES = [
	"queued",
	"confirming_deposit",
	"checking_name",
	"submitting_origin",
	"waiting_origin",
	"waiting_attestation",
	"submitting_claim",
	"waiting_claim",
] as Array<typeof flows.$inferSelect.status>;

export { PUBLIC_CACHE };

export async function publicBalances(depositAddress: string) {
	const balances = await readNativeUsdcBalances(depositAddress);
	return balances.map((balance) => ({
		chainId: String(balance.chainId),
		amount: balance.amount ?? null,
	}));
}

export async function activity(limit: number, cursor?: ActivityCursor) {
	const [result, active] = await Promise.all([
		renewalActivity(limit, cursor),
		database()
			.select({ flow: flows, name: names })
			.from(flows)
			.innerJoin(names, eq(flows.nameId, names.id))
			.where(inArray(flows.status, LIVE_FLOW_STATUSES))
			.orderBy(desc(flows.createdAt))
			.limit(6),
	]);
	return {
		items: result.items.map(({ renewal, name }) => ({ renewal, name })),
		flows: active.map(({ flow, name }) => ({ flow: publicFlowView(flow), name: publicNameView(name) })),
		nextCursor: result.nextCursor,
	};
}

export async function renewalActivity(
	limit: number,
	cursor?: ActivityCursor,
	nameId?: string,
) {
	const ensRenewal = alias(chainEvents, "ens_renewal");
	const originIntent = alias(transactionIntents, "activity_origin_intent");
	const claimIntent = alias(transactionIntents, "activity_claim_intent");
	const rows = await database()
		.select({
			event: chainEvents,
			name: names,
			flow: flows,
			deposit: deposits,
			ensFacts: ensRenewal.facts,
			originTxHash: originIntent.currentTxHash,
			claimTxHash: claimIntent.currentTxHash,
		})
		.from(chainEvents)
		.innerJoin(
			names,
			sql<boolean>`lower(${chainEvents.facts}->>'label_hash') = lower(${names.labelHash})`,
		)
		.innerJoin(flows, eq(flows.renewalEventId, chainEvents.eventId))
		.leftJoin(deposits, eq(deposits.eventId, flows.depositEventId))
		.leftJoin(originIntent, eq(originIntent.id, flows.originTxIntentId))
		.leftJoin(claimIntent, eq(claimIntent.id, flows.claimTxIntentId))
		.leftJoin(
			ensRenewal,
			and(
				eq(ensRenewal.txHash, chainEvents.txHash),
				eq(ensRenewal.eventFamily, "ens"),
				eq(ensRenewal.eventType, "NameRenewed"),
				eq(ensRenewal.canonical, true),
			),
		)
		.where(
			and(
				eq(chainEvents.canonical, true),
				eq(chainEvents.eventFamily, "namepass"),
				eq(chainEvents.eventType, "Renewed"),
				nameId ? eq(names.id, nameId) : undefined,
				cursor
					? or(
						lt(chainEvents.blockTime, cursor.blockTime),
						and(
							eq(chainEvents.blockTime, cursor.blockTime),
							lt(chainEvents.eventId, cursor.eventId),
						),
					)
					: undefined,
			),
		)
		.orderBy(desc(chainEvents.blockTime), desc(chainEvents.eventId))
		.limit(limit + 1);
	const page = rows.slice(0, limit);
	const last = page[page.length - 1]?.event;
	return {
		items: page.map(({ event, name, flow, deposit, ensFacts, originTxHash, claimTxHash }) => ({
			renewal: publicRenewalView(
				event,
				flow,
				deposit,
				ensFacts,
				originTxHash,
				claimTxHash,
			),
			name: publicNameView(name),
		})),
		nextCursor:
			rows.length > limit && last
				? { blockTime: last.blockTime, eventId: last.eventId }
				: undefined,
	};
}

export async function leaderboard(limit: number) {
	const rows = await database()
		.select()
		.from(names)
		.orderBy(desc(names.timeDeliveredSeconds), desc(names.lifetimeReceived))
		.limit(limit);
	return { items: rows.map(publicNameView) };
}

export async function stats() {
	const [row] = await database()
		.select({
			names: sql<string>`count(*)`,
			lifetimeReceived: sql<string>`coalesce(sum(${names.lifetimeReceived}), 0)`,
			lifetimeApplied: sql<string>`coalesce(sum(${names.lifetimeApplied}), 0)`,
			timeDeliveredSeconds: sql<string>`coalesce(sum(${names.timeDeliveredSeconds}), 0)`,
		})
		.from(names);
	return row;
}

export async function publicFlow(id: string) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
		throw new ApiError(400, "invalid_flow_id", "The flow ID must be a UUID.");
	}
	const originIntent = alias(transactionIntents, "origin_intent");
	const claimIntent = alias(transactionIntents, "claim_intent");
	const [row] = await database()
		.select({ flow: flows, origin: originIntent, claim: claimIntent })
		.from(flows)
		.leftJoin(originIntent, eq(flows.originTxIntentId, originIntent.id))
		.leftJoin(claimIntent, eq(flows.claimTxIntentId, claimIntent.id))
		.where(eq(flows.id, id));
	if (!row) throw new ApiError(404, "flow_not_found", "This flow does not exist.");
	const hashes = [row.origin?.currentTxHash, row.claim?.currentTxHash].filter(
		(hash): hash is string => Boolean(hash),
	);
	const linkedRenewal = row.flow.renewalEventId
		? await database()
			.select({ txHash: chainEvents.txHash, facts: chainEvents.facts })
			.from(chainEvents)
			.where(and(eq(chainEvents.eventId, row.flow.renewalEventId), eq(chainEvents.canonical, true)))
			.then((items) => items[0])
		: undefined;
	const renewals = !linkedRenewal && hashes.length
		? await database()
			.select({ txHash: chainEvents.txHash, facts: chainEvents.facts })
			.from(chainEvents)
			.where(and(eq(chainEvents.canonical, true), eq(chainEvents.eventFamily, "namepass"), eq(chainEvents.eventType, "Renewed"), inArray(chainEvents.txHash, hashes)))
		: [];
	const renewal = linkedRenewal ?? renewals[0];
	const facts = renewal?.facts as Record<string, unknown> | null;
	const executor = typeof facts?.executor_address === "string" ? checksumAddress(facts.executor_address) : null;
	const relayer = configuredRelayerAddress();
	return {
		flow: publicFlowView(row.flow, {
			originTxHash: row.origin?.currentTxHash ?? null,
			claimTxHash: row.claim?.currentTxHash ?? null,
			renewalTxHash: renewal?.txHash ?? null,
			executorAddress: executor,
			executorIsRelayer: executor !== null && executor === relayer,
		}),
	};
}

export function publicRenewalView(
	event: typeof chainEvents.$inferSelect,
	flow: typeof flows.$inferSelect,
	deposit: typeof deposits.$inferSelect | null,
	ensFacts: unknown,
	originTxHash: string | null,
	claimTxHash: string | null,
) {
	const facts = event.facts as Record<string, unknown>;
	const executorAddress = checksumAddress(String(facts.executor_address));
	const relayer = configuredRelayerAddress();
	const expiry = ensFacts && typeof ensFacts === "object"
		? String((ensFacts as Record<string, unknown>).new_expiry ?? "")
		: "";
	const expiryMilliseconds = /^\d+$/.test(expiry) ? BigInt(expiry) * 1_000n : null;
	const indexedExpiry = expiryMilliseconds !== null && expiryMilliseconds <= 8_640_000_000_000_000n
		? new Date(Number(expiryMilliseconds)).toISOString()
		: null;
	return {
		eventId: event.eventId,
		flowId: flow.id,
		originChainId: flow.originChainId,
		funderAddress: deposit?.senderAddress ? checksumAddress(deposit.senderAddress) : null,
		executorAddress,
		executorIsRelayer: relayer !== null && executorAddress === relayer,
		amountReceived: String(facts.amount_received),
		gasAllowance: String(facts.gas_allowance),
		amountApplied: String(facts.amount_applied),
		durationSeconds: String(facts.duration),
		expiryAfter: indexedExpiry ?? flow.expiryAfter?.toISOString() ?? null,
		fromCctp: facts.from_cctp === "true",
		depositTxHash: deposit?.txHash ?? null,
		originTxHash,
		claimTxHash,
		renewalTxHash: event.txHash,
		blockTime: event.blockTime,
	};
}

export function publicConfig() {
	return {
		relayerAddress: configuredRelayerAddress(),
		chains: PUBLIC_CHAINS.map((chain) => ({
			...chain,
			minimumTriggerAmount: CHAIN_TRIGGER_CONFIG.find(
				(config) => config.chainId === chain.chainId,
			)!.minimumTriggerAmount,
		})),
		testnet: PUBLIC_CHAINS.every((chain) => chain.testnet),
	};
}

export function publicNameView(name: typeof names.$inferSelect) {
	return {
		label: name.normalizedLabel,
		displayName: name.displayName,
		depositAddress: checksumAddress(name.depositAddress),
		activatedAt: name.activatedAt,
		currentExpiry: name.currentExpiry,
		renewableBy: name.renewableBy,
		ensSyncedAt: name.ensSyncedAt,
		unscannedChainIds: name.unscannedChainIds,
		lifetimeReceived: name.lifetimeReceived,
		lifetimeApplied: name.lifetimeApplied,
		timeDeliveredSeconds: name.timeDeliveredSeconds,
		renewalCount: name.renewalCount,
	};
}

export type PublicFlowEvidence = {
	originTxHash: string | null;
	claimTxHash: string | null;
	renewalTxHash: string | null;
	executorAddress: string | null;
	executorIsRelayer: boolean;
};

export function publicFlowView(
	flow: typeof flows.$inferSelect,
	evidence: PublicFlowEvidence = {
		originTxHash: null,
		claimTxHash: null,
		renewalTxHash: null,
		executorAddress: null,
		executorIsRelayer: false,
	},
) {
	return {
		id: flow.id,
		originChainId: flow.originChainId,
		trigger: flow.trigger,
		status: flow.status,
		holdReason: flow.holdReason,
		amountDetected: flow.amountDetected,
		amountProcessed: flow.amountProcessed,
		remainingAmount: flow.remainingAmount,
		gasAllowance: flow.gasAllowance,
		amountApplied: flow.amountApplied,
		durationSeconds: flow.durationSeconds,
		cctpNonce: flow.cctpNonce,
		lastErrorCode: flow.lastErrorCode,
		nextActionAt: flow.nextActionAt,
		queuedAt: flow.queuedAt,
		confirmingDepositAt: flow.confirmingDepositAt,
		checkingNameAt: flow.checkingNameAt,
		submittingOriginAt: flow.submittingOriginAt,
		waitingOriginAt: flow.waitingOriginAt,
		waitingAttestationAt: flow.waitingAttestationAt,
		submittingClaimAt: flow.submittingClaimAt,
		waitingClaimAt: flow.waitingClaimAt,
		heldAt: flow.heldAt,
		unclaimedAt: flow.unclaimedAt,
		settledAt: flow.settledAt,
		cancelledAt: flow.cancelledAt,
		failedAt: flow.failedAt,
		createdAt: flow.createdAt,
		updatedAt: flow.updatedAt,
		evidence,
	};
}

export function publicDepositView(deposit: typeof deposits.$inferSelect) {
	return {
		eventId: deposit.eventId,
		chainId: deposit.chainId,
		tokenAddress: checksumAddress(deposit.tokenAddress),
		senderAddress: deposit.senderAddress
			? checksumAddress(deposit.senderAddress)
			: null,
		amount: deposit.amount,
		txHash: deposit.txHash,
		logIndex: deposit.logIndex,
		blockNumber: deposit.blockNumber,
		blockTime: deposit.blockTime,
		source: deposit.source,
		status: deposit.status,
	};
}
