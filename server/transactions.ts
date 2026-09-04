import { and, eq, sql } from "drizzle-orm";
import {
	createPublicClient,
	http,
	keccak256,
	TransactionReceiptNotFoundError,
	type Address,
	type Hex,
	type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { chainById, type ChainDefinition } from "../src/lib/chains";
import { configuredRelayerPrivateKeys } from "./config";
import { database } from "./db/client";
import { flows, flowTransitions, relayerNonces, transactionIntents } from "./db/schema";
import { setFlowStatus } from "./flow-state";
import { logOperation, logWarning } from "./log";

export function chainClient(chain: ChainDefinition) {
	const url = process.env[chain.rpcEnv];
	if (!url) throw new Error(`${chain.rpcEnv} is not configured.`);
	return createPublicClient({ transport: http(url) });
}

/** Check the endpoint before each step that can spend relayer gas. */
export async function verifiedChainClient(chain: ChainDefinition) {
	const client = chainClient(chain);
	const actual = await client.getChainId();
	if (actual !== chain.chainId) {
		throw new Error(`RPC chain ID ${actual} does not match ${chain.chainId}.`);
	}
	return client;
}

export async function withVerifiedChainClient<T>(
	chain: ChainDefinition,
	work: (client: ReturnType<typeof chainClient>) => Promise<T>,
): Promise<T> {
	return work(await verifiedChainClient(chain));
}

export function relayerAccount() {
	const account = relayerAccounts()[0];
	if (!account) throw new Error("A relayer private key is not configured.");
	return account;
}

export function relayerAccounts() {
	return configuredRelayerPrivateKeys().map((key) => privateKeyToAccount(key));
}

export function relayerAccountForAddress(address: string) {
	const account = relayerAccounts().find(
		(candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
	);
	if (!account) throw new Error("The transaction relayer is not in the configured relayer set.");
	return account;
}

/** Ethereum uses all four lanes. Source chains keep the primary relayer. */
export function relayerCandidatesForChain<T>(chain: ChainDefinition, accounts: readonly T[]): readonly T[] {
	return chain.key === "ethereum" ? accounts : accounts.slice(0, 1);
}

/** Lock one configured lane that has no unresolved transaction intent. */
export function freeRelayerLaneSql(chainId: number, addresses: readonly string[]) {
	if (!addresses.length) throw new Error("At least one relayer address is required.");
	return sql`
		select rn.relayer_address, rn.next_nonce
		from relayer_nonces rn
		where rn.chain_id = ${String(chainId)}
			and rn.relayer_address in (${sql.join(addresses.map((address) => sql`${address}`), sql`, `)})
			and not exists (
				select 1 from transaction_intents ti
				where ti.chain_id = rn.chain_id
					and ti.from_address = rn.relayer_address
					and ti.status in ('prepared', 'broadcast', 'cancellation_requested', 'cancelling')
			)
		order by rn.updated_at, rn.relayer_address
		for update of rn skip locked
		limit 1
	`;
}

export function reserveNonce(databaseNextNonce: bigint, rpcPendingNonce: bigint): bigint {
	return databaseNextNonce > rpcPendingNonce ? databaseNextNonce : rpcPendingNonce;
}

export function gasLimitWithSafetyMargin(estimatedGas: bigint): bigint {
	return estimatedGas + estimatedGas / 5n;
}

export function replacementFee(previous: bigint, current: bigint | undefined): bigint {
	const bumped = previous + previous / 8n + 1n;
	return current !== undefined && current > bumped ? current : bumped;
}

/** Return every hash that may settle one logical transaction intent. */
export function transactionAttemptHashes(
	currentTxHash: unknown,
	attempts: unknown,
	currentNonce?: unknown,
): string[] {
	const hashes = new Set<string>();
	if (Array.isArray(attempts)) {
		for (const attempt of attempts) {
			if (
				attempt
				&& typeof attempt === "object"
				&& "hash" in attempt
				&& typeof attempt.hash === "string"
				&& (currentNonce === undefined || ("nonce" in attempt && String(attempt.nonce) === String(currentNonce)))
			) {
				hashes.add(attempt.hash.toLowerCase());
			}
		}
	}
	if (typeof currentTxHash === "string") hashes.add(currentTxHash.toLowerCase());
	return [...hashes];
}

/** Match Goldsky evidence even when an older same-nonce replacement attempt was mined. */
export function transactionHashMatchesIntentSql(txHash: string) {
	return sql<boolean>`(
		lower(${transactionIntents.currentTxHash}) = lower(${txHash})
		or exists (
			select 1
			from jsonb_array_elements(${transactionIntents.attempts}) as attempt
			where lower(attempt->>'hash') = lower(${txHash})
				and attempt->>'nonce' = ${transactionIntents.nonce}::text
		)
	)`;
}

/** Stop duplicate work without leaving an unconsumed nonce gap. */
export function requestTransactionCancellationSql(flowIds: readonly string[], now: Date) {
	if (!flowIds.length) throw new Error("At least one flow is required for transaction cancellation.");
	return sql`
		update transaction_intents
		set status = 'cancellation_requested',
			error = jsonb_build_object('code', 'duplicate_message_settled'),
			updated_at = ${now}
		where flow_id in (${sql.join(flowIds.map((flowId) => sql`${flowId}`), sql`, `)})
			and status in ('prepared', 'broadcast')
	`;
}

/** A mined revert consumes its nonce. Resume with a new signed attempt, not stale bytes. */
export function transactionIntentAction(status: string | undefined): "reuse" | "retry" {
	return status === "reverted" ? "retry" : "reuse";
}

export function originRevertFlowPatch(now: Date) {
	return {
		status: "held" as const,
		holdReason: "origin_reverted",
		lastErrorCode: "origin_reverted",
		workflowRunId: null,
		heldAt: now,
		updatedAt: now,
	};
}

export function isKnownTransactionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	return message.includes("already known") || message.includes("already imported");
}

export function isNonceTooLowError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	return message.includes("nonce too low") || message.includes("nonce has already been used");
}

export function isInsufficientFundsError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	return message.includes("insufficient funds");
}

export type ConsumedNonceResolution = "receipt_found" | "receipt_pending" | "not_consumed";

/** Resolve a nonce error without assuming that the newest signed attempt won. */
export async function reconcileConsumedNonce(
	intentNonce: bigint,
	readReceipt: () => Promise<unknown | undefined>,
	readLatestNonce: () => Promise<bigint>,
): Promise<ConsumedNonceResolution> {
	if (await readReceipt()) return "receipt_found";
	return await readLatestNonce() > intentNonce ? "receipt_pending" : "not_consumed";
}

export function isMissingTransactionReceipt(error: unknown): boolean {
	return error instanceof TransactionReceiptNotFoundError;
}

type TransactionInput = {
	flowId: string;
	kind: "origin_renew" | "claim";
	chain: ChainDefinition;
	to: Address;
	callData: Hex;
};

async function signAttempt(input: TransactionInput, intentId?: string): Promise<string> {
	const db = database();
	let fixedRelayerAddress: string | undefined;
	if (!intentId) {
		const [existing] = await db
			.select({ id: transactionIntents.id })
			.from(transactionIntents)
			.where(and(eq(transactionIntents.flowId, input.flowId), eq(transactionIntents.kind, input.kind)));
		if (existing) return existing.id;
	} else {
		const [existing] = await db.select({
			status: transactionIntents.status,
			fromAddress: transactionIntents.fromAddress,
		}).from(transactionIntents).where(eq(transactionIntents.id, intentId));
		if (!existing) throw new Error("The transaction intent does not exist.");
		if (existing.status !== "reverted") return intentId;
		fixedRelayerAddress = existing.fromAddress;
	}
	const chainAccounts = relayerCandidatesForChain(input.chain, relayerAccounts());
	const accounts = fixedRelayerAddress
		? chainAccounts.filter((account) => account.address.toLowerCase() === fixedRelayerAddress?.toLowerCase())
		: chainAccounts;
	if (!accounts.length) throw new Error("No relayer account is configured for this chain.");
	const rpc = await verifiedChainClient(input.chain);
	await Promise.all(accounts.map((account) => db.execute(
		sql`insert into relayer_nonces (chain_id, relayer_address, next_nonce) values (${String(input.chain.chainId)}, ${account.address.toLowerCase()}, '0') on conflict do nothing`,
	)));
	/* Do not hold a database lane lock while waiting on RPC. Pending nonces are
	   snapshots; the locked database counter still serializes local reservations. */
	const [estimatedGas, fees, pendingNonces] = await Promise.all([
		rpc.estimateGas({ account: accounts[0], to: input.to, data: input.callData }),
		rpc.estimateFeesPerGas(),
		Promise.all(accounts.map(async (account) => ({
			address: account.address.toLowerCase(),
			nonce: BigInt(await rpc.getTransactionCount({ address: account.address, blockTag: "pending" })),
		}))),
	]);
	const pendingByAddress = new Map(pendingNonces.map(({ address, nonce }) => [address, nonce]));
	return db.transaction(async (tx) => {
		await tx.execute(sql`select id from flows where id = ${input.flowId} for update`);
		if (!intentId) {
			const [existing] = await tx
				.select({ id: transactionIntents.id })
				.from(transactionIntents)
				.where(and(eq(transactionIntents.flowId, input.flowId), eq(transactionIntents.kind, input.kind)));
			if (existing) return existing.id;
		} else {
			const [current] = await tx.select({ status: transactionIntents.status })
				.from(transactionIntents).where(eq(transactionIntents.id, intentId));
			if (!current) throw new Error("The transaction intent does not exist.");
			if (current.status !== "reverted") return intentId;
		}

		const addresses = accounts.map((account) => account.address.toLowerCase());
		const locked = await tx.execute<{ relayer_address: string; next_nonce: string }>(
			freeRelayerLaneSql(input.chain.chainId, addresses),
		);
		const lane = locked.rows[0];
		if (!lane) {
			logWarning("relayer.pool_saturated", {
				flowId: input.flowId,
				chainId: input.chain.chainId,
				step: input.kind,
				errorCode: "no_relayer_lane",
			});
			throw new Error("No relayer lane is free on this chain.");
		}
		const account = accounts.find(
			(candidate) => candidate.address.toLowerCase() === lane.relayer_address.toLowerCase(),
		);
		if (!account) throw new Error("The leased relayer lane has no configured key.");
		const livePending = pendingByAddress.get(account.address.toLowerCase());
		if (livePending === undefined) throw new Error("The relayer pending nonce was not loaded.");
		const nonce = reserveNonce(BigInt(lane.next_nonce), livePending);
		const gas = gasLimitWithSafetyMargin(estimatedGas);
		const raw = await account.signTransaction({
			chainId: input.chain.chainId,
			to: input.to,
			data: input.callData,
			nonce: Number(nonce),
			gas,
			maxFeePerGas: fees.maxFeePerGas,
			maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
		});
		const hash = keccak256(raw);
		const attempt = {
			hash,
			nonce: String(nonce),
			maxFeePerGas: fees.maxFeePerGas ? String(fees.maxFeePerGas) : null,
			maxPriorityFeePerGas: fees.maxPriorityFeePerGas
				? String(fees.maxPriorityFeePerGas)
				: null,
			broadcastAt: null,
		};
		let savedId = intentId;
		if (intentId) {
			const [current] = await tx
				.select({ attempts: transactionIntents.attempts })
				.from(transactionIntents)
				.where(eq(transactionIntents.id, intentId));
			if (!current) throw new Error("The transaction intent does not exist.");
			const attempts = Array.isArray(current.attempts) ? current.attempts : [];
			await tx
				.update(transactionIntents)
				.set({
					fromAddress: account.address.toLowerCase(),
					nonce: String(nonce),
					gasLimit: String(gas),
					maxFeePerGas: attempt.maxFeePerGas,
					maxPriorityFeePerGas: attempt.maxPriorityFeePerGas,
					currentRawTransaction: raw,
					currentTxHash: hash,
					attempts: [...attempts, attempt],
					status: "prepared",
					broadcastAt: null,
					lastBroadcastAttemptAt: null,
					pendingWarnedAt: null,
					confirmedAt: null,
					receipt: null,
					error: null,
					updatedAt: new Date(),
				})
				.where(eq(transactionIntents.id, intentId));
		} else {
			const [intent] = await tx.insert(transactionIntents).values({
				flowId: input.flowId,
				kind: input.kind,
				chainId: String(input.chain.chainId),
				fromAddress: account.address.toLowerCase(),
				toAddress: input.to.toLowerCase(),
				nonce: String(nonce),
				callData: input.callData,
				gasLimit: String(gas),
				maxFeePerGas: fees.maxFeePerGas ? String(fees.maxFeePerGas) : null,
				maxPriorityFeePerGas: fees.maxPriorityFeePerGas
					? String(fees.maxPriorityFeePerGas)
					: null,
				currentRawTransaction: raw,
				currentTxHash: hash,
				attempts: [attempt],
				status: "prepared",
				lastBroadcastAttemptAt: null,
			}).returning({ id: transactionIntents.id });
			if (!intent) throw new Error("Could not create the transaction intent.");
			savedId = intent.id;
		}
		if (!savedId) throw new Error("Could not save the transaction intent.");

		const [flow] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, input.flowId));
		if (!flow) throw new Error("The flow does not exist.");
		const now = new Date();
		const nextStatus = input.kind === "claim" ? "submitting_claim" : "submitting_origin";
		await tx
			.update(relayerNonces)
			.set({ nextNonce: String(nonce + 1n), updatedAt: now })
			.where(
				and(
					eq(relayerNonces.chainId, String(input.chain.chainId)),
					eq(relayerNonces.relayerAddress, account.address.toLowerCase()),
				),
			);
		await tx
			.update(flows)
			.set({
				...(input.kind === "claim"
					? { claimTxIntentId: savedId, submittingClaimAt: now }
					: { originTxIntentId: savedId, submittingOriginAt: now }),
				status: nextStatus,
				updatedAt: now,
			})
			.where(eq(flows.id, input.flowId));
		await tx.insert(flowTransitions).values({
			flowId: input.flowId,
			fromStatus: flow.status,
			toStatus: nextStatus,
			actor: "workflow",
		});
		return savedId;
	});
}

export async function prepareTransaction(input: TransactionInput): Promise<string> {
	const [linked] = await database()
		.select({ id: transactionIntents.id })
		.from(transactionIntents)
		.where(and(eq(transactionIntents.flowId, input.flowId), eq(transactionIntents.kind, input.kind)));
	const id = linked?.id ?? await signAttempt(input);
	logOperation("transaction.prepared", { flowId: input.flowId, chainId: input.chain.chainId, step: input.kind });
	return id;
}

/** Sign a new attempt after a mined revert. It keeps the same logical claim and message. */
export async function retryTransaction(intentId: string): Promise<string> {
	const [intent] = await database().select().from(transactionIntents).where(eq(transactionIntents.id, intentId));
	if (!intent) throw new Error("The transaction intent does not exist.");
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	return signAttempt(
		{
			flowId: intent.flowId,
			kind: intent.kind,
			chain,
			to: intent.toAddress as Address,
			callData: intent.callData as Hex,
		},
		intent.id,
	);
}

export async function broadcastTransaction(intentId: string): Promise<string> {
	"use step";
	const [intent] = await database().select().from(transactionIntents).where(eq(transactionIntents.id, intentId));
	if (!intent?.currentRawTransaction || !intent.currentTxHash) {
		throw new Error("The transaction intent has no signed transaction.");
	}
	if (!new Set(["prepared", "cancelling"]).has(intent.status)) return intent.currentTxHash;
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	const attemptedAt = new Date();
	let accepted = false;
	try {
		await withVerifiedChainClient(chain, async (rpc) => {
			try {
				await rpc.sendRawTransaction({
					serializedTransaction: intent.currentRawTransaction as Hex,
				});
				accepted = true;
			} catch (error) {
				if (isKnownTransactionError(error)) {
					accepted = true;
					return;
				}
				if (!isNonceTooLowError(error)) throw error;
				const resolution = await reconcileConsumedNonce(
					BigInt(intent.nonce),
					() => readTransactionReceipt(intentId),
					async () => BigInt(await rpc.getTransactionCount({
						address: intent.fromAddress as Address,
						blockTag: "latest",
					})),
				);
				if (resolution === "not_consumed") throw error;
				accepted = true;
				if (resolution === "receipt_pending") logWarning("transaction.nonce_consumed_receipt_pending", {
					flowId: intent.flowId,
					chainId: intent.chainId,
					step: intent.kind,
					errorCode: "nonce_consumed_receipt_pending",
				});
			}
		});
	} catch (error) {
		await database().update(transactionIntents).set({
			lastBroadcastAttemptAt: sql`coalesce(${transactionIntents.lastBroadcastAttemptAt}, ${attemptedAt})`,
			error: { code: isInsufficientFundsError(error) ? "insufficient_funds" : "broadcast_rejected" },
			updatedAt: attemptedAt,
		}).where(and(
			eq(transactionIntents.id, intentId),
			eq(transactionIntents.currentTxHash, intent.currentTxHash),
			eq(transactionIntents.status, intent.status),
		));
		throw error;
	}
	const attempts = Array.isArray(intent.attempts) ? [...intent.attempts] : [];
	const last = attempts[attempts.length - 1];
	if (accepted && last && typeof last === "object") {
		attempts[attempts.length - 1] = { ...last, broadcastAt: attemptedAt.toISOString() };
	}
	const [updated] = await database()
		.update(transactionIntents)
		.set({
			status: intent.status === "cancelling" ? "cancelling" : "broadcast",
			attempts,
			broadcastAt: attemptedAt,
			lastBroadcastAttemptAt: sql`coalesce(${transactionIntents.lastBroadcastAttemptAt}, ${attemptedAt})`,
			error: null,
			updatedAt: attemptedAt,
		})
		.where(and(
			eq(transactionIntents.id, intentId),
			eq(transactionIntents.currentTxHash, intent.currentTxHash),
			eq(transactionIntents.status, intent.status),
		))
		.returning({ id: transactionIntents.id });
	if (updated && intent.status !== "cancelling") {
		await setFlowStatus(intent.flowId, intent.kind === "claim" ? "waiting_claim" : "waiting_origin");
	}
	logOperation("transaction.broadcast", { flowId: intent.flowId, chainId: intent.chainId, step: intent.kind });
	return intent.currentTxHash;
}

/** Broadcast prepared bytes once. A resumed workflow reuses an existing transaction hash. */
export async function ensureTransactionBroadcast(intentId: string): Promise<string> {
	"use step";
	const [intent] = await database()
		.select({
			status: transactionIntents.status,
			broadcastAt: transactionIntents.broadcastAt,
			lastBroadcastAttemptAt: transactionIntents.lastBroadcastAttemptAt,
			currentTxHash: transactionIntents.currentTxHash,
		})
		.from(transactionIntents)
		.where(eq(transactionIntents.id, intentId));
	if (!intent?.currentTxHash) throw new Error("The transaction intent has no transaction hash.");
	if (intent.status === "prepared" && intent.broadcastAt === null) {
		return broadcastTransaction(intentId);
	}
	return intent.currentTxHash;
}

export const PENDING_TRANSACTION_WARNING_MS = 30_000;

export function transactionMonitorTiming(
	pendingSince: Date | null,
	pendingWarnedAt: Date | null,
	now: Date,
	replacementMs: number,
): { warn: boolean; replace: boolean } {
	if (!pendingSince) return { warn: false, replace: false };
	const age = now.getTime() - pendingSince.getTime();
	return {
		warn: !pendingWarnedAt && age >= PENDING_TRANSACTION_WARNING_MS,
		replace: age >= replacementMs,
	};
}

async function isLaneHead(intent: typeof transactionIntents.$inferSelect): Promise<boolean> {
	const [earlier] = await database().select({ id: transactionIntents.id })
		.from(transactionIntents)
		.where(and(
			eq(transactionIntents.chainId, intent.chainId),
			eq(transactionIntents.fromAddress, intent.fromAddress),
			sql`${transactionIntents.status} in ('prepared', 'broadcast', 'cancellation_requested', 'cancelling')`,
			sql`${transactionIntents.nonce} < ${intent.nonce}`,
		))
		.limit(1);
	return !earlier;
}

/** Replace pending work at the same nonce. Cancellation uses a zero-value self-transfer. */
export async function replaceStaleTransaction(intentId: string, now = new Date()): Promise<string | undefined> {
	const [intent] = await database().select().from(transactionIntents).where(eq(transactionIntents.id, intentId));
	if (!intent?.currentTxHash || !new Set(["prepared", "broadcast", "cancelling"]).has(intent.status)) return intent?.currentTxHash ?? undefined;
	if (!(await isLaneHead(intent))) return intent.currentTxHash;
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	const pendingSince = intent.broadcastAt ?? intent.lastBroadcastAttemptAt;
	if (!pendingSince || pendingSince.getTime() > now.getTime() - chain.polling.transactionReplacementMs) {
		return intent.currentTxHash;
	}
	if ((intent.error as { code?: unknown } | null)?.code === "insufficient_funds") {
		return broadcastTransaction(intentId);
	}
	if (!intent.currentRawTransaction || !intent.gasLimit || !intent.maxFeePerGas || !intent.maxPriorityFeePerGas) {
		throw new Error("The pending transaction does not contain replaceable EIP-1559 fields.");
	}
	if (await readTransactionReceipt(intentId)) return intent.currentTxHash;
	const account = relayerAccountForAddress(intent.fromAddress);
	const rpc = await verifiedChainClient(chain);
	const nonce = BigInt(intent.nonce);
	const [latestNonce, fees] = await Promise.all([
		rpc.getTransactionCount({ address: account.address, blockTag: "latest" }),
		rpc.estimateFeesPerGas(),
	]);
	if (BigInt(latestNonce) > nonce) {
		const resolution = await reconcileConsumedNonce(
			nonce,
			() => readTransactionReceipt(intentId),
			async () => BigInt(latestNonce),
		);
		if (resolution === "receipt_found") return intent.currentTxHash;
		logWarning("transaction.nonce_consumed_receipt_pending", {
			flowId: intent.flowId,
			chainId: intent.chainId,
			step: intent.kind,
			errorCode: "nonce_consumed_receipt_pending",
		});
		return intent.currentTxHash;
	}
	const maxFeePerGas = replacementFee(BigInt(intent.maxFeePerGas), fees.maxFeePerGas);
	const maxPriorityFeePerGas = replacementFee(
		BigInt(intent.maxPriorityFeePerGas),
		fees.maxPriorityFeePerGas,
	);
	const raw = await account.signTransaction({
		chainId: chain.chainId,
		to: intent.status === "cancelling" ? account.address : intent.toAddress as Address,
		data: intent.status === "cancelling" ? "0x" : intent.callData as Hex,
		value: intent.status === "cancelling" ? 0n : BigInt(intent.value),
		nonce: Number(nonce),
		gas: intent.status === "cancelling" ? 21_000n : BigInt(intent.gasLimit),
		maxFeePerGas,
		maxPriorityFeePerGas,
	});
	const hash = keccak256(raw);
	const attempts = Array.isArray(intent.attempts) ? [...intent.attempts] : [];
	const [updated] = await database().update(transactionIntents).set({
		currentRawTransaction: raw,
		currentTxHash: hash,
		maxFeePerGas: String(maxFeePerGas),
		maxPriorityFeePerGas: String(maxPriorityFeePerGas),
		attempts: [...attempts, {
			hash,
			nonce: intent.nonce,
			maxFeePerGas: String(maxFeePerGas),
			maxPriorityFeePerGas: String(maxPriorityFeePerGas),
			broadcastAt: null,
			...(intent.status === "cancelling" ? { purpose: "cancel" } : {}),
		}],
		status: intent.status === "cancelling" ? "cancelling" : "prepared",
		broadcastAt: null,
		lastBroadcastAttemptAt: null,
		updatedAt: now,
	}).where(and(
		eq(transactionIntents.id, intentId),
		eq(transactionIntents.status, intent.status),
		eq(transactionIntents.currentTxHash, intent.currentTxHash),
	)).returning({ id: transactionIntents.id });
	if (!updated) {
		return (await database().select({ hash: transactionIntents.currentTxHash })
			.from(transactionIntents).where(eq(transactionIntents.id, intentId)))[0]?.hash ?? undefined;
	}
	logOperation("transaction.replaced", { flowId: intent.flowId, chainId: intent.chainId, step: intent.kind });
	return broadcastTransaction(intentId);
}

export type TransactionMonitorResult = "broadcast" | "receipt_found" | "replaced" | "waiting" | "deferred";

async function prepareCancellationTransaction(
	intent: typeof transactionIntents.$inferSelect,
	now: Date,
): Promise<string | undefined> {
	if (!intent.currentTxHash) return undefined;
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	const account = relayerAccountForAddress(intent.fromAddress);
	const rpc = await verifiedChainClient(chain);
	const fees = await rpc.estimateFeesPerGas();
	const maxFeePerGas = intent.maxFeePerGas
		? replacementFee(BigInt(intent.maxFeePerGas), fees.maxFeePerGas)
		: fees.maxFeePerGas;
	const maxPriorityFeePerGas = intent.maxPriorityFeePerGas
		? replacementFee(BigInt(intent.maxPriorityFeePerGas), fees.maxPriorityFeePerGas)
		: fees.maxPriorityFeePerGas;
	if (!maxFeePerGas || !maxPriorityFeePerGas) throw new Error("The cancellation fee quote is incomplete.");
	const raw = await account.signTransaction({
		chainId: chain.chainId,
		to: account.address,
		data: "0x",
		value: 0n,
		nonce: Number(BigInt(intent.nonce)),
		gas: 21_000n,
		maxFeePerGas,
		maxPriorityFeePerGas,
	});
	const hash = keccak256(raw);
	const attempts = Array.isArray(intent.attempts) ? [...intent.attempts] : [];
	const [updated] = await database().update(transactionIntents).set({
		maxFeePerGas: String(maxFeePerGas),
		maxPriorityFeePerGas: String(maxPriorityFeePerGas),
		currentRawTransaction: raw,
		currentTxHash: hash,
		attempts: [...attempts, {
			hash,
			nonce: intent.nonce,
			maxFeePerGas: String(maxFeePerGas),
			maxPriorityFeePerGas: String(maxPriorityFeePerGas),
			broadcastAt: null,
			purpose: "cancel",
		}],
		status: "cancelling",
		broadcastAt: null,
		lastBroadcastAttemptAt: null,
		pendingWarnedAt: null,
		error: { code: "duplicate_message_cancelling" },
		updatedAt: now,
	}).where(and(
		eq(transactionIntents.id, intent.id),
		eq(transactionIntents.status, "cancellation_requested"),
		eq(transactionIntents.currentTxHash, intent.currentTxHash),
	)).returning({ id: transactionIntents.id });
	if (!updated) return undefined;
	await broadcastTransaction(intent.id);
	return hash;
}

/** Monitor one logical transaction. Only the lowest unresolved nonce can act in its lane. */
export async function monitorTransactionIntent(
	intentId: string,
	now = new Date(),
): Promise<TransactionMonitorResult> {
	const [intent] = await database().select().from(transactionIntents).where(eq(transactionIntents.id, intentId));
	if (!intent?.currentTxHash || !new Set(["prepared", "broadcast", "cancellation_requested", "cancelling"]).has(intent.status)) return "deferred";
	if (!(await isLaneHead(intent))) return "deferred";
	const receipt = await readTransactionReceipt(intentId);
	if (receipt) {
		await database().update(transactionIntents).set({
			status: new Set(["cancellation_requested", "cancelling"]).has(intent.status) ? "cancelled" : "mined",
			confirmedAt: now,
			receipt: receipt as unknown as Record<string, unknown>,
			updatedAt: now,
		}).where(and(
			eq(transactionIntents.id, intentId),
			eq(transactionIntents.status, intent.status),
			eq(transactionIntents.currentTxHash, intent.currentTxHash),
		));
		return "receipt_found";
	}
	if (intent.status === "cancellation_requested") {
		return await prepareCancellationTransaction(intent, now) ? "replaced" : "deferred";
	}
	if (new Set(["prepared", "cancelling"]).has(intent.status) && !intent.lastBroadcastAttemptAt) {
		await broadcastTransaction(intentId);
		return "broadcast";
	}
	const pendingSince = intent.broadcastAt ?? intent.lastBroadcastAttemptAt;
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	const timing = transactionMonitorTiming(
		pendingSince,
		intent.pendingWarnedAt,
		now,
		chain.polling.transactionReplacementMs,
	);
	if (timing.warn) {
		const [warned] = await database().update(transactionIntents).set({
			pendingWarnedAt: now,
			updatedAt: now,
		}).where(and(
			eq(transactionIntents.id, intentId),
			sql`${transactionIntents.pendingWarnedAt} is null`,
		)).returning({ id: transactionIntents.id });
		if (warned) {
			logWarning("transaction.pending", {
				flowId: intent.flowId,
				chainId: intent.chainId,
				step: intent.kind,
				errorCode: "transaction_pending",
			});
		}
	}
	if (timing.replace) {
		const previousHash = intent.currentTxHash;
		const hash = await replaceStaleTransaction(intentId, now);
		return hash && hash.toLowerCase() !== previousHash.toLowerCase() ? "replaced" : "waiting";
	}
	return "waiting";
}

export async function readTransactionReceipt(intentId: string): Promise<TransactionReceipt | undefined> {
	"use step";
	const [intent] = await database().select().from(transactionIntents).where(eq(transactionIntents.id, intentId));
	if (!intent?.currentTxHash) throw new Error("The transaction intent has no transaction hash.");
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	const rpc = await verifiedChainClient(chain);
	for (const hash of transactionAttemptHashes(intent.currentTxHash, intent.attempts, intent.nonce).reverse()) {
		try {
			return await rpc.getTransactionReceipt({ hash: hash as Hex });
		} catch (error) {
			if (!isMissingTransactionReceipt(error)) throw error;
		}
	}
	return undefined;
}
