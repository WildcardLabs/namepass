import { and, eq, sql } from "drizzle-orm";
import {
	createPublicClient,
	http,
	keccak256,
	type Address,
	type Hex,
	type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { chainById, type ChainDefinition } from "../src/lib/chains";
import { database } from "./db/client";
import { flows, flowTransitions, relayerNonces, transactionIntents } from "./db/schema";
import { setFlowStatus } from "./flow-state";
import { logOperation } from "./log";

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
	const key = process.env.RELAYER_PRIVATE_KEY;
	if (!key || !/^0x[0-9a-f]{64}$/i.test(key)) {
		throw new Error("RELAYER_PRIVATE_KEY is not configured.");
	}
	return privateKeyToAccount(key as Hex);
}

export function reserveNonce(databaseNextNonce: bigint, rpcPendingNonce: bigint): bigint {
	return databaseNextNonce > rpcPendingNonce ? databaseNextNonce : rpcPendingNonce;
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

type TransactionInput = {
	flowId: string;
	kind: "origin_renew" | "claim";
	chain: ChainDefinition;
	to: Address;
	callData: Hex;
};

async function signAttempt(input: TransactionInput, intentId?: string): Promise<string> {
	const db = database();
	const account = relayerAccount();
	const { gas, fees, pending } = await withVerifiedChainClient(input.chain, async (rpc) => ({
		gas: await rpc.estimateGas({ account, to: input.to, data: input.callData }),
		fees: await rpc.estimateFeesPerGas(),
		pending: await rpc.getTransactionCount({ address: account.address, blockTag: "pending" }),
	}));
	return db.transaction(async (tx) => {
		if (!intentId) {
			const [existing] = await tx
				.select({ id: transactionIntents.id })
				.from(transactionIntents)
				.where(and(eq(transactionIntents.flowId, input.flowId), eq(transactionIntents.kind, input.kind)));
			if (existing) return existing.id;
		}

		await tx.execute(sql`insert into relayer_nonces (chain_id, relayer_address, next_nonce) values (${String(input.chain.chainId)}, ${account.address.toLowerCase()}, ${String(pending)}) on conflict do nothing`);
		const locked = await tx.execute<{ next_nonce: string }>(sql`select next_nonce from relayer_nonces where chain_id = ${String(input.chain.chainId)} and relayer_address = ${account.address.toLowerCase()} for update`);
		const next = locked.rows[0]?.next_nonce;
		if (next === undefined) throw new Error("Could not lock the relayer nonce.");
		const nonce = reserveNonce(BigInt(next), BigInt(pending));
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
					nonce: String(nonce),
					gasLimit: String(gas),
					maxFeePerGas: attempt.maxFeePerGas,
					maxPriorityFeePerGas: attempt.maxPriorityFeePerGas,
					currentRawTransaction: raw,
					currentTxHash: hash,
					attempts: [...attempts, attempt],
					status: "prepared",
					broadcastAt: null,
					confirmedAt: null,
					receipt: null,
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
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	await withVerifiedChainClient(chain, async (rpc) => {
		try {
			await rpc.sendRawTransaction({
				serializedTransaction: intent.currentRawTransaction as Hex,
			});
		} catch (error) {
			if (!isKnownTransactionError(error)) throw error;
		}
	});
	const broadcastAt = new Date();
	const attempts = Array.isArray(intent.attempts) ? [...intent.attempts] : [];
	const last = attempts[attempts.length - 1];
	if (last && typeof last === "object") {
		attempts[attempts.length - 1] = { ...last, broadcastAt: broadcastAt.toISOString() };
	}
	await database()
		.update(transactionIntents)
		.set({ status: "broadcast", attempts, broadcastAt, updatedAt: broadcastAt })
		.where(eq(transactionIntents.id, intentId));
	await setFlowStatus(intent.flowId, intent.kind === "claim" ? "waiting_claim" : "waiting_origin");
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

export async function readTransactionReceipt(intentId: string): Promise<TransactionReceipt | undefined> {
	"use step";
	const [intent] = await database().select().from(transactionIntents).where(eq(transactionIntents.id, intentId));
	if (!intent?.currentTxHash) throw new Error("The transaction intent has no transaction hash.");
	const chain = chainById(Number(intent.chainId));
	if (!chain) throw new Error(`Chain ${intent.chainId} is not active.`);
	const rpc = await verifiedChainClient(chain);
	try {
		return await rpc.getTransactionReceipt({ hash: intent.currentTxHash as Hex });
	} catch {
		return undefined;
	}
}
