import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
	decodeEventLog,
	encodeFunctionData,
	getAddress,
	parseAbi,
	type Address,
	type Hex,
} from "viem";
import { FatalError } from "workflow";

import { chainById, HUB_CHAIN } from "../src/lib/chains";
import {
	encodeCompleteCctp,
	parseClaimReceipt,
	parseOriginBurnReceipt,
	validateCctpMessage,
	type ReceiptLog,
} from "../workflows/cctp";
import { pollIris, type IrisResult } from "../workflows/iris";
import { cctpFlowRowsLockSql, cctpIdentityAction, cctpIdentityLockSql } from "./cctp-identity";
import { markBalanceScanRequested, originWalletLockSql, requestBalanceScanSql } from "./balance-scan";
import { labelHash, readEnsState } from "./chain";
import { database } from "./db/client";
import {
	chainEvents,
	deposits,
	flows,
	flowTransitions,
	names,
	transactionIntents,
} from "./db/schema";
import { ABSORBED_BY_PRIOR_FLOW, flowTransitionAction, NAME_RECHECK_MS, setFlowStatus, setPreOriginFlowStatus } from "./flow-state";
import { automaticDepositBalanceBlock, liveDepositBalanceAction } from "./deposit-eligibility";
import { readReceiptEnsExpiry } from "./ens-renewal";
import {
	assertExactCctpSettlement,
	settlementBundleForEvent,
	type SettlementEventBundle,
	type SettlementIdentityEvent,
} from "./settlement-identity";
import {
	ensureTransactionBroadcast,
	prepareTransaction,
	pollTransactionReceipt,
	replaceStaleTransaction,
	isMissingTransactionReceipt,
	relayerAccount,
	retryTransaction,
	transactionReceiptMatchesCurrentNonce,
	transactionIntentAction,
	originRevertFlowPatch,
	verifiedChainClient,
} from "./transactions";

const FACTORY_ABI = parseAbi(["function renew(string label)"]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const HELPER_ABI = parseAbi([
	"function completeCCTP(bytes message, bytes attestation)",
	"error NameNotRenewable()",
	"error InsufficientAmount()",
	"error InvalidCCTPMessage()",
	"error InvalidWallet()",
	"error UnexpectedMintAmount()",
	"error InvalidLabel()",
	"error InvalidOracleConfig()",
]);
const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const UNCLAIMED_RETRY_MS = 6 * 60 * 60 * 1_000;
const ARC_NATIVE_USDC_SCALE = 1_000_000_000_000n;
export const CCTP_ORIGIN_REVERTED = "origin_reverted";

export function cctpOriginTransactionHash(
	originEvidenceTxHash: Hex | null,
	currentTxHash: string | null | undefined,
): Hex | undefined {
	return originEvidenceTxHash ?? (currentTxHash as Hex | undefined);
}

export type CctpFlow = {
	id: string;
	nameId: string;
	status: typeof flows.$inferSelect.status;
	trigger: typeof flows.$inferSelect.trigger;
	label: string;
	depositAddress: Address;
	depositEventId: string | null;
	depositTxHash: Hex | null;
	depositLogIndex: number | null;
	depositBlockNumber: string | null;
	eligibilityBlockNumber: string | null;
	depositCanonical: boolean | null;
	depositStatus: typeof deposits.$inferSelect.status | null;
	depositAmount: string | null;
	originChainId: number;
	amountDetected: string;
	amountProcessed: string | null;
	remainingAmount: string | null;
	originIntentId: string | null;
	originEventId: string | null;
	originEventTxHash: Hex | null;
	originEventLogIndex: number | null;
	originEventBlockNumber: string | null;
	originEventCanonical: boolean | null;
	originEvidenceTxHash: Hex | null;
	originIntentStatus: typeof transactionIntents.$inferSelect.status | null;
	claimIntentId: string | null;
	claimIntentStatus: typeof transactionIntents.$inferSelect.status | null;
	cctpNonce: string | null;
	cctpMessageIndex: number | null;
	cctpMessage: Hex | null;
	cctpAttestation: Hex | null;
};

export function matchesRecordedCctpDepositTransfer(
	transfer: { to: Address; value: bigint },
	depositAddress: string,
	depositAmount: string | null,
): boolean {
	return depositAmount !== null
		&& getAddress(transfer.to) === getAddress(depositAddress)
		&& transfer.value === BigInt(depositAmount);
}

/** Arc transaction value has 18 decimals. The USDC system contract has 6 decimals. */
export function matchesRecordedArcNativeDeposit(
	transaction: { to: Address | null; value: bigint },
	depositAddress: string,
	depositAmount: string | null,
): boolean {
	return transaction.to !== null
		&& depositAmount !== null
		&& transaction.value % ARC_NATIVE_USDC_SCALE === 0n
		&& getAddress(transaction.to) === getAddress(depositAddress)
		&& transaction.value / ARC_NATIVE_USDC_SCALE === BigInt(depositAmount);
}

function receiptLogs(logs: readonly unknown[]): ReceiptLog[] {
	return logs.map((value) => {
		const log = value as { address: Address; data: Hex; topics: readonly Hex[]; logIndex?: number | null };
		return {
			address: log.address,
			data: log.data,
			topics: [...log.topics] as [Hex, ...Hex[]],
			...(typeof log.logIndex === "number" ? { logIndex: log.logIndex } : {}),
		};
	});
}

export async function loadCctpFlow(flowId: string): Promise<CctpFlow | undefined> {
	"use step";
	const originIntent = alias(transactionIntents, "cctp_origin_intent");
	const claimIntent = alias(transactionIntents, "cctp_claim_intent");
	const originEvent = alias(chainEvents, "cctp_origin_event");
	const [row] = await database()
		.select({
			flow: flows,
			name: names,
			deposit: deposits,
			event: chainEvents,
			originIntentStatus: originIntent.status,
			claimIntentStatus: claimIntent.status,
			originEventTxHash: originEvent.txHash,
			originEventLogIndex: originEvent.logIndex,
			originEventBlockNumber: originEvent.blockNumber,
			originEventCanonical: originEvent.canonical,
		})
		.from(flows)
		.innerJoin(names, eq(flows.nameId, names.id))
		.leftJoin(deposits, eq(flows.depositEventId, deposits.eventId))
		.leftJoin(chainEvents, eq(deposits.eventId, chainEvents.eventId))
		.leftJoin(originIntent, eq(flows.originTxIntentId, originIntent.id))
		.leftJoin(claimIntent, eq(flows.claimTxIntentId, claimIntent.id))
		.leftJoin(originEvent, eq(flows.originEventId, originEvent.eventId))
		.where(eq(flows.id, flowId));
	if (!row) return undefined;
	const eligibilityBlockNumber = await automaticDepositBalanceBlock({
		trigger: row.flow.trigger,
		nameId: row.flow.nameId,
		chainId: row.flow.originChainId,
		createdAt: row.flow.createdAt,
		linkedBlockNumber: row.deposit?.blockNumber ?? null,
	});
	return {
		id: row.flow.id,
		nameId: row.flow.nameId,
		status: row.flow.status,
		trigger: row.flow.trigger,
		label: row.name.normalizedLabel,
		depositAddress: row.name.depositAddress as Address,
		depositEventId: row.flow.depositEventId,
		depositTxHash: (row.deposit?.txHash as Hex | undefined) ?? null,
		depositLogIndex: row.deposit?.logIndex ?? null,
		depositBlockNumber: row.deposit?.blockNumber ?? null,
		eligibilityBlockNumber,
		depositCanonical: row.event?.canonical ?? null,
		depositStatus: row.deposit?.status ?? null,
		depositAmount: row.deposit?.amount ?? null,
		originChainId: Number(row.flow.originChainId),
		amountDetected: row.flow.amountDetected,
		amountProcessed: row.flow.amountProcessed,
		remainingAmount: row.flow.remainingAmount,
		originIntentId: row.flow.originTxIntentId,
		originEventId: row.flow.originEventId,
		originEventTxHash: (row.originEventTxHash as Hex | null) ?? null,
		originEventLogIndex: row.originEventLogIndex,
		originEventBlockNumber: row.originEventBlockNumber,
		originEventCanonical: row.originEventCanonical,
		originEvidenceTxHash: row.flow.originEvidenceTxHash as Hex | null,
		originIntentStatus: row.originIntentStatus,
		claimIntentId: row.flow.claimTxIntentId,
		claimIntentStatus: row.claimIntentStatus,
		cctpNonce: row.flow.cctpNonce,
		cctpMessageIndex: row.flow.cctpMessageIndex,
		cctpMessage: (row.flow.cctpMessage as Hex | null) ?? null,
		cctpAttestation: (row.flow.cctpAttestation as Hex | null) ?? null,
	};
}

function originChain(flow: CctpFlow) {
	const chain = chainById(flow.originChainId);
	if (!chain || chain.key === "ethereum" || !chain.factoryAddress || !chain.polling.attestation) {
		throw new FatalError("The flow does not have an active CCTP origin chain.");
	}
	return chain;
}

export async function confirmCctpDeposit(flowId: string): Promise<"ready" | "cancelled"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "cancelled") return "cancelled";
	if (!flow.depositTxHash || flow.depositLogIndex === null) return "ready";
	if (!flow.depositCanonical || flow.depositStatus === "orphaned") {
		const outcome = await setPreOriginFlowStatus(
			flowId,
			["queued", "confirming_deposit"],
			"cancelled",
			{},
			"deposit_orphaned",
		);
		return outcome.applied || outcome.status === "cancelled" ? "cancelled" : "ready";
	}
	await setFlowStatus(flowId, "confirming_deposit");
	const chain = originChain(flow);
	const rpc = await verifiedChainClient(chain);
	const [receipt, transaction] = await Promise.all([
		rpc.getTransactionReceipt({ hash: flow.depositTxHash }),
		chain.key === "arc" ? rpc.getTransaction({ hash: flow.depositTxHash }) : Promise.resolve(undefined),
	]);
	if (
		receipt.status !== "success"
		|| (flow.depositBlockNumber !== null && receipt.blockNumber !== BigInt(flow.depositBlockNumber))
	) {
		const outcome = await setPreOriginFlowStatus(flowId, ["confirming_deposit"], "cancelled", {}, "deposit_not_canonical");
		return outcome.applied || outcome.status === "cancelled" ? "cancelled" : "ready";
	}
	if (
		chain.key === "arc"
		&& transaction
		&& transaction.blockHash === receipt.blockHash
		&& matchesRecordedArcNativeDeposit(transaction, flow.depositAddress, flow.depositAmount)
	) {
		return "ready";
	}
	const log = receipt.logs.find((candidate) => candidate.logIndex === flow.depositLogIndex);
	if (!log || getAddress(log.address) !== getAddress(chain.usdcAddress)) {
		const outcome = await setPreOriginFlowStatus(flowId, ["confirming_deposit"], "cancelled", {}, "deposit_not_canonical");
		return outcome.applied || outcome.status === "cancelled" ? "cancelled" : "ready";
	}
	const transfer = decodeEventLog({
		abi: TRANSFER_ABI,
		data: log.data,
		topics: (log as unknown as { topics: [Hex, ...Hex[]] }).topics,
	}) as { eventName: "Transfer"; args: { to: Address; value: bigint } };
	if (transfer.eventName !== "Transfer" || !matchesRecordedCctpDepositTransfer(
		transfer.args,
		flow.depositAddress,
		flow.depositAmount,
	)) {
		const outcome = await setPreOriginFlowStatus(flowId, ["confirming_deposit"], "cancelled", {}, "deposit_not_to_wallet");
		return outcome.applied || outcome.status === "cancelled" ? "cancelled" : "ready";
	}
	return "ready";
}

export async function checkCctpEligibility(flowId: string): Promise<"ready" | "held" | "cancelled"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "settled") return "ready";
	if (flow.status === "cancelled") return "cancelled";
	await setFlowStatus(flowId, "checking_name");
	const chain = originChain(flow);
	const rpc = await verifiedChainClient(chain);
	const balanceBlock = flow.eligibilityBlockNumber !== null
		? BigInt(flow.eligibilityBlockNumber)
		: undefined;
	const [ens, liveBlock] = await Promise.all([
		readEnsState(flow.label),
		rpc.getBlockNumber(),
	]);
	if (balanceBlock !== undefined && liveBlock < balanceBlock) {
		throw new Error("The origin RPC has not reached the verified deposit block.");
	}
	const liveBalancePromise = rpc.readContract({
		address: chain.usdcAddress as Address,
		abi: ERC20_ABI,
		functionName: "balanceOf",
		args: [flow.depositAddress],
		authorizationList: undefined,
		blockNumber: liveBlock,
	});
	const [liveBalance, verifiedBalance] = await Promise.all([
		liveBalancePromise,
		balanceBlock === undefined || balanceBlock === liveBlock
			? liveBalancePromise
			: rpc.readContract({
			address: chain.usdcAddress as Address,
			abi: ERC20_ABI,
			functionName: "balanceOf",
			args: [flow.depositAddress],
			authorizationList: undefined,
			blockNumber: balanceBlock,
		}),
	]);
	const balanceAction = liveDepositBalanceAction({
		verifiedBalance,
		verifiedBlock: balanceBlock,
		liveBalance,
		liveBlock,
	});
	if (balanceAction !== "ready") {
		if (balanceAction === "retry") {
			throw new Error("The deposit block does not contain the verified wallet balance.");
		}
		const reason = balanceAction === "absorbed" ? ABSORBED_BY_PRIOR_FLOW : "empty_wallet";
		if (balanceAction === "absorbed") {
			await markBalanceScanRequested({
				nameId: flow.nameId,
				chainId: flow.originChainId,
				requestedThroughBlock: liveBlock,
			});
		}
		const outcome = await setPreOriginFlowStatus(flowId, ["checking_name"], "cancelled", {
			holdReason: null,
			lastErrorDetail: null,
		}, reason);
		const cancelled = outcome.applied || outcome.status === "cancelled";
		return cancelled ? "cancelled" : "ready";
	}
	if (!ens.renewableBy) {
		const outcome = await setPreOriginFlowStatus(flowId, ["checking_name"], "held", {
			holdReason: "name_not_renewable",
			nextActionAt: new Date(Date.now() + NAME_RECHECK_MS),
		}, "name_not_renewable");
		return outcome.applied || outcome.status === "held" ? "held" : "ready";
	}
	return "ready";
}

export async function prepareCctpOrigin(flowId: string): Promise<string | null> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.originIntentId) {
		const [intent] = await database().select({ status: transactionIntents.status })
			.from(transactionIntents).where(eq(transactionIntents.id, flow.originIntentId));
		return transactionIntentAction(intent?.status) === "retry"
			? retryTransaction(flow.originIntentId)
			: flow.originIntentId;
	}
	const chain = originChain(flow);
	try {
		return await prepareTransaction({
			flowId,
			kind: "origin_renew",
			chain,
			to: chain.factoryAddress! as Address,
			callData: encodeFunctionData({ abi: FACTORY_ABI, functionName: "renew", args: [flow.label] }),
		});
	} catch (error) {
		let liveBlock: bigint;
		let liveBalance: bigint;
		try {
			const rpc = await verifiedChainClient(chain);
			liveBlock = await rpc.getBlockNumber();
			liveBalance = await rpc.readContract({
				address: chain.usdcAddress as Address,
				abi: ERC20_ABI,
				functionName: "balanceOf",
				args: [flow.depositAddress],
				authorizationList: undefined,
				blockNumber: liveBlock,
			});
		} catch {
			throw error;
		}
		if (
			flow.eligibilityBlockNumber === null
			|| liveBlock <= BigInt(flow.eligibilityBlockNumber)
			|| liveBalance > 0n
		) throw error;
		await markBalanceScanRequested({
			nameId: flow.nameId,
			chainId: flow.originChainId,
			requestedThroughBlock: liveBlock,
		});
		const outcome = await setPreOriginFlowStatus(
			flowId,
			["checking_name"],
			"cancelled",
			{ holdReason: null, lastErrorDetail: null },
			ABSORBED_BY_PRIOR_FLOW,
		);
		if (outcome.applied || outcome.status === "cancelled") return null;
		throw error;
	}
}

async function markCctpOriginReverted(
	flowId: string,
	intentId: string,
	receipt: Record<string, unknown>,
): Promise<"held" | "settled" | "cancelled" | "failed" | "superseded"> {
	return database().transaction(async (tx) => {
		const [flow] = await tx.select({
			status: flows.status,
			originTxIntentId: flows.originTxIntentId,
		}).from(flows)
			.where(eq(flows.id, flowId))
			.for("update");
		if (!flow) throw new Error("The flow does not exist.");
		if (flow.status === "settled" || flow.status === "cancelled" || flow.status === "failed") return flow.status;
		if (flow.originTxIntentId !== intentId) return "superseded";
		const [intent] = await tx.select({
			currentTxHash: transactionIntents.currentTxHash,
			attempts: transactionIntents.attempts,
			nonce: transactionIntents.nonce,
			status: transactionIntents.status,
		}).from(transactionIntents)
			.where(eq(transactionIntents.id, intentId))
			.for("update");
		if (!intent) throw new Error("The transaction intent does not exist.");
		const receiptHash = String(receipt.transactionHash ?? "");
		if (!transactionReceiptMatchesCurrentNonce(intent, receiptHash)) {
			throw new Error("The origin receipt does not belong to the intent's current nonce.");
		}
		if (intent.status === "reverted") return flow.status === "held" ? "held" : "superseded";
		if (!["prepared", "broadcast", "mined"].includes(intent.status)) {
			throw new Error("A revert receipt conflicts with the transaction intent state.");
		}
		const now = new Date();
		await tx.update(transactionIntents).set({
			status: "reverted",
			confirmedAt: now,
			receipt,
			updatedAt: now,
		}).where(eq(transactionIntents.id, intentId));
		await tx.update(flows).set(originRevertFlowPatch(now)).where(eq(flows.id, flowId));
		if (flow.status !== "held") {
			await tx.insert(flowTransitions).values({
				flowId,
				fromStatus: flow.status,
				toStatus: "held",
				actor: "workflow",
				reasonCode: CCTP_ORIGIN_REVERTED,
			});
		}
		return "held";
	});
}

async function readCctpOriginReceipt(flow: CctpFlow, intentId: string | null) {
	if (!flow.originEvidenceTxHash) {
		return intentId ? pollTransactionReceipt(intentId) : undefined;
	}
	const rpc = await verifiedChainClient(originChain(flow));
	try {
		return await rpc.getTransactionReceipt({ hash: flow.originEvidenceTxHash });
	} catch (error) {
		if (isMissingTransactionReceipt(error)) {
			if (intentId) await replaceStaleTransaction(intentId);
			return undefined;
		}
		throw error;
	}
}

function assertOriginEventReceipt(
	flow: CctpFlow,
	receipt: { transactionHash: Hex; blockNumber: bigint },
): void {
	if (flow.originEventId && (
		flow.originEventCanonical !== true
		|| flow.originEventTxHash?.toLowerCase() !== receipt.transactionHash.toLowerCase()
		|| (flow.originEventBlockNumber !== null
			&& BigInt(flow.originEventBlockNumber) !== receipt.blockNumber)
	)) {
		throw new Error("The recorded origin event does not match the canonical receipt.");
	}
}

function parseFlowOriginBurn(
	flow: CctpFlow,
	logs: readonly unknown[],
) {
	return parseOriginBurnReceipt(receiptLogs(logs), {
		originChainId: flow.originChainId,
		wallet: flow.depositAddress,
		label: flow.label,
		labelHash: labelHash(flow.label) as Hex,
		...(flow.amountProcessed === null ? {} : { amount: BigInt(flow.amountProcessed) }),
		...(flow.originEventLogIndex === null ? {} : { depositLogIndex: flow.originEventLogIndex }),
	});
}

export async function confirmCctpOrigin(
	flowId: string,
	intentId: string | null,
): Promise<"queued" | "waiting" | "held" | "cancelled" | "attestation" | "settled" | "failed" | "superseded"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "cancelled") return "cancelled";
	if (flow.status === "settled" || flow.status === "failed") return flow.status;
	if (flow.cctpMessage) return "attestation";
	const receipt = await readCctpOriginReceipt(flow, intentId);
	if (receipt === "queued") return "queued";
	if (!receipt) return "waiting";
	if (receipt.status !== "success") {
		if (intentId) {
			return markCctpOriginReverted(flowId, intentId, receipt as unknown as Record<string, unknown>);
		}
		throw new Error("The indexed external origin transaction reverted.");
	}
	assertOriginEventReceipt(flow, receipt);
	const burn = parseFlowOriginBurn(flow, receipt.logs);
	const now = new Date();
	const outcome = await database().transaction(async (tx) => {
		await tx.execute(originWalletLockSql(flow.nameId, flow.originChainId));
		const [current] = await tx.select({
			status: flows.status,
			originEventId: flows.originEventId,
			originTxIntentId: flows.originTxIntentId,
		}).from(flows)
			.where(eq(flows.id, flowId))
			.for("update");
		if (!current) throw new Error("The flow does not exist.");
		if (current.status === "cancelled") return "cancelled" as const;
		if (current.status === "settled" || current.status === "failed") return current.status;
		if (flow.originEventId && current.originEventId !== flow.originEventId) return "stale" as const;
		if (intentId && current.originTxIntentId !== intentId) return "stale" as const;
		if (intentId) {
			const [intent] = await tx.select({
				currentTxHash: transactionIntents.currentTxHash,
				attempts: transactionIntents.attempts,
				nonce: transactionIntents.nonce,
			}).from(transactionIntents)
				.where(eq(transactionIntents.id, intentId))
				.for("update");
			if (!intent) throw new Error("The transaction intent does not exist.");
			if (!transactionReceiptMatchesCurrentNonce(intent, receipt.transactionHash)) {
				return "stale" as const;
			}
			await tx.update(transactionIntents).set({
				status: "confirmed",
				confirmedAt: now,
				receipt: receipt as unknown as Record<string, unknown>,
				updatedAt: now,
			}).where(eq(transactionIntents.id, intentId));
		}
		await tx.update(flows).set({
			status: "waiting_attestation",
			originEvidenceTxHash: receipt.transactionHash,
			originEvidenceBlockNumber: receipt.blockNumber.toString(),
			amountProcessed: burn.amount.toString(),
			remainingAmount: burn.remaining.toString(),
			cctpNonce: null,
			cctpMessageIndex: burn.messageIndex,
			cctpMessage: burn.message.raw,
			waitingAttestationAt: now,
			updatedAt: now,
		}).where(eq(flows.id, flowId));
		if (burn.remaining > 0n) {
			await tx.execute(requestBalanceScanSql({
				nameId: flow.nameId,
				chainId: flow.originChainId,
				requestedThroughBlock: receipt.blockNumber,
			}));
			await tx.update(names).set({
				unscannedChainIds: sql`case
					when ${String(flow.originChainId)}::numeric = any(${names.unscannedChainIds})
					then ${names.unscannedChainIds}
					else array_append(${names.unscannedChainIds}, ${String(flow.originChainId)}::numeric)
				end`,
			}).where(eq(names.id, flow.nameId));
		}
		if (current.status !== "waiting_attestation") {
			await tx.insert(flowTransitions).values({
				flowId,
				fromStatus: current.status,
				toStatus: "waiting_attestation",
				actor: "workflow",
				detail: { nonce: burn.message.nonce },
			});
		}
		return "advanced" as const;
	});
	if (outcome === "cancelled") return "cancelled";
	if (outcome === "settled" || outcome === "failed") return outcome;
	return outcome === "stale" ? "superseded" : "attestation";
}

async function recoverCctpMessageIndex(
	flow: CctpFlow,
	originTxHash: Hex,
): Promise<number> {
	const receipt = await (await verifiedChainClient(originChain(flow)))
		.getTransactionReceipt({ hash: originTxHash });
	if (receipt.status !== "success") {
		throw new Error("The stored CCTP origin transaction reverted.");
	}
	assertOriginEventReceipt(flow, receipt);
	const burn = parseFlowOriginBurn(flow, receipt.logs);
	if (burn.message.raw.toLowerCase() !== flow.cctpMessage?.toLowerCase()) {
		throw new Error("The stored CCTP message does not match its origin receipt.");
	}
	const [stored] = await database().update(flows).set({
		cctpMessageIndex: burn.messageIndex,
		updatedAt: new Date(),
	}).where(and(
		eq(flows.id, flow.id),
		isNull(flows.cctpMessageIndex),
		eq(flows.cctpMessage, flow.cctpMessage),
		ne(flows.status, "cancelled"),
		ne(flows.status, "failed"),
	)).returning({ messageIndex: flows.cctpMessageIndex });
	if (stored?.messageIndex !== null && stored?.messageIndex !== undefined) return stored.messageIndex;
	const [current] = await database().select({ messageIndex: flows.cctpMessageIndex })
		.from(flows)
		.where(eq(flows.id, flow.id));
	if (current?.messageIndex === null || current?.messageIndex === undefined) {
		throw new Error("The flow changed while its Circle message index was recovered.");
	}
	return current.messageIndex;
}

export async function pollCctpAttestation(flowId: string, attempt: number): Promise<IrisResult> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if ((!flow?.originIntentId && !flow?.originEvidenceTxHash) || !flow.cctpMessage) {
		throw new Error("The origin CCTP message is missing.");
	}
	if (!flow.amountProcessed) throw new Error("The origin CCTP amount is missing.");
	const result: IrisResult = flow.cctpAttestation
		? { kind: "complete", message: flow.cctpMessage, attestation: flow.cctpAttestation, status: "complete" }
		: await (async () => {
			const [intent] = flow.originIntentId
				? await database().select({ txHash: transactionIntents.currentTxHash })
					.from(transactionIntents).where(eq(transactionIntents.id, flow.originIntentId))
				: [];
			const originTxHash = cctpOriginTransactionHash(flow.originEvidenceTxHash, intent?.txHash);
			if (!originTxHash) throw new Error("The origin transaction hash is missing.");
			const chain = originChain(flow);
			const polling = chain.polling.attestation!;
			const messageIndex = flow.cctpMessageIndex
				?? await recoverCctpMessageIndex(flow, originTxHash);
			return pollIris({
				baseUrl: process.env.CIRCLE_IRIS_URL ?? "",
				sourceDomain: chain.circleDomain,
				transactionHash: originTxHash as Hex,
				messageIndex,
				attempt,
				initialDelayMs: polling.initialMs,
				maxDelayMs: polling.maxMs,
			});
		})();
	if (result.kind === "pending") {
		await setFlowStatus(flowId, "waiting_attestation", {
			lastErrorCode: `iris_${result.reason}`,
			nextActionAt: new Date(Date.now() + result.retryAfterMs),
		});
		return result;
	}
	const message = validateCctpMessage(result.message, {
		originChainId: flow.originChainId,
		wallet: flow.depositAddress,
		label: flow.label,
		amount: BigInt(flow.amountProcessed!),
	});
	const cctpNonce = BigInt(message.nonce).toString();
	const [ownerBeforeLock] = await database().select({
		id: flows.id,
		renewalEventId: flows.renewalEventId,
	}).from(flows).where(and(
		ne(flows.id, flowId),
		eq(flows.originChainId, String(flow.originChainId)),
		eq(flows.cctpNonce, cctpNonce),
	));
	let settlementBeforeLock: SettlementEventBundle | null | undefined;
	if (ownerBeforeLock?.renewalEventId) {
		const [renewalIdentity] = await database().select({
			chainId: chainEvents.chainId,
			txHash: chainEvents.txHash,
		}).from(chainEvents).where(eq(chainEvents.eventId, ownerBeforeLock.renewalEventId));
		if (!renewalIdentity) {
			settlementBeforeLock = null;
		} else {
			const transactionEvents = await database().select({
				eventId: chainEvents.eventId,
				eventFamily: chainEvents.eventFamily,
				eventType: chainEvents.eventType,
				logIndex: chainEvents.logIndex,
				canonical: chainEvents.canonical,
				facts: chainEvents.facts,
			}).from(chainEvents).where(and(
				eq(chainEvents.chainId, renewalIdentity.chainId),
				eq(chainEvents.txHash, renewalIdentity.txHash),
			));
			settlementBeforeLock = settlementBundleForEvent(
				transactionEvents as SettlementIdentityEvent[],
				ownerBeforeLock.renewalEventId,
			) ?? null;
		}
	}
	await database().transaction(async (tx) => {
		const originChainId = String(flow.originChainId);
		await tx.execute(cctpIdentityLockSql(originChainId, cctpNonce));
		const ownerIds = await tx.select({ id: flows.id }).from(flows).where(and(
			eq(flows.originChainId, originChainId),
			eq(flows.cctpNonce, cctpNonce),
		));
		const idsToLock = [...new Set([flowId, ...ownerIds.map((owner) => owner.id)])];
		await tx.execute(cctpFlowRowsLockSql(idsToLock));
		const [current] = await tx.select().from(flows).where(eq(flows.id, flowId));
		if (!current) throw new Error("The flow does not exist.");
		if (current.status === "cancelled" || current.status === "failed") return;
		if (current.cctpMessage?.toLowerCase() !== flow.cctpMessage!.toLowerCase()) return;
		const owners = await tx.select().from(flows).where(and(
			eq(flows.originChainId, originChainId),
			eq(flows.cctpNonce, cctpNonce),
		));
		if (owners.length > 1) throw new Error("One Circle message is linked to multiple active flows.");
		const owner = owners[0];
		const action = cctpIdentityAction(current, owner);
		if (action === "conflict") {
			throw new Error("The Circle message owner conflicts with the source flow.");
		}
		const now = new Date();
		if (action === "merge_external" && owner) {
			if (current.amountProcessed === null) {
				throw new Error("The source flow does not have a processed CCTP amount.");
			}
			if (
				owner.nameId !== current.nameId
				|| owner.originChainId !== current.originChainId
				|| owner.amountProcessed !== current.amountProcessed
			) {
				throw new Error("The external settlement does not match the source flow.");
			}
			if (
				owner.id !== ownerBeforeLock?.id
				|| owner.renewalEventId !== ownerBeforeLock.renewalEventId
			) {
				throw new Error("The external settlement owner changed before validation.");
			}
			if (!settlementBeforeLock) {
				throw new Error("The external settlement does not match an exact event bundle.");
			}
			assertExactCctpSettlement(settlementBeforeLock, {
				sourceDomain: String(originChain(flow).circleDomain),
				nonce: cctpNonce,
				walletAddress: flow.depositAddress,
				burnAmount: current.amountProcessed,
			});
			await tx.update(flows).set({
				renewalEventId: null,
				cctpNonce: null,
				status: "cancelled",
				workflowRunId: null,
				lastErrorCode: "duplicate_flow_merged",
				lastErrorDetail: null,
				nextActionAt: null,
				cancelledAt: now,
				updatedAt: now,
			}).where(eq(flows.id, owner.id));
			await tx.update(flows).set({
				status: "settled",
				renewalEventId: owner.renewalEventId,
				cctpMessage: result.message,
				cctpNonce,
				cctpAttestation: result.attestation,
				gasAllowance: owner.gasAllowance,
				amountApplied: owner.amountApplied,
				durationSeconds: owner.durationSeconds,
				expiryAfter: owner.expiryAfter,
				holdReason: null,
				lastErrorCode: null,
				lastErrorDetail: null,
				nextActionAt: null,
				workflowRunId: null,
				settledAt: owner.settledAt ?? now,
				updatedAt: now,
			}).where(eq(flows.id, flowId));
			await tx.insert(flowTransitions).values({
				flowId: owner.id,
				fromStatus: owner.status,
				toStatus: "cancelled",
				actor: "workflow",
				reasonCode: "duplicate_flow_merged",
				detail: { canonicalFlowId: flowId },
			});
			if (current.status !== "settled") {
				await tx.insert(flowTransitions).values({
					flowId,
					fromStatus: current.status,
					toStatus: "settled",
					actor: "workflow",
					reasonCode: "external_settlement_merged",
					detail: { mergedFlowId: owner.id },
				});
			}
			return;
		}
		const nextStatus = flowTransitionAction(current.status, "waiting_attestation") === "apply"
			? "waiting_attestation"
			: current.status;
		await tx.update(flows).set({
			status: nextStatus,
			cctpMessage: result.message,
			cctpNonce,
			cctpAttestation: result.attestation,
			lastErrorCode: null,
			nextActionAt: null,
			updatedAt: now,
		}).where(eq(flows.id, flowId));
	});
	return result;
}

export function claimErrorName(error: unknown): string | undefined {
	let value: unknown = error;
	for (let depth = 0; depth < 8 && value && typeof value === "object"; depth += 1) {
		const object = value as Record<string, unknown>;
		if (typeof object.errorName === "string") return object.errorName;
		value = object.cause;
	}
	return undefined;
}

export function claimIntentAction(status: string | undefined): "reuse" | "retry" {
	return status === "reverted" ? "retry" : "reuse";
}

async function markUnclaimed(flowId: string, reasonCode: string): Promise<void> {
	await setFlowStatus(
		flowId,
		"unclaimed",
		{
			holdReason: reasonCode,
			lastErrorCode: reasonCode,
			nextActionAt: new Date(Date.now() + UNCLAIMED_RETRY_MS),
			workflowRunId: null,
		},
		reasonCode,
	);
}

export async function simulateCctpClaim(flowId: string): Promise<"ready" | "unclaimed" | "settled"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "settled") return "settled";
	if (!flow.cctpMessage || !flow.cctpAttestation) throw new Error("The attested CCTP message is missing.");
	if (!(await readEnsState(flow.label)).renewableBy) {
		await markUnclaimed(flowId, "name_not_renewable");
		return "unclaimed";
	}
	try {
		const rpc = await verifiedChainClient(HUB_CHAIN);
		await rpc.simulateContract({
			address: HUB_CHAIN.gatewayAddress! as Address,
			abi: HELPER_ABI,
			functionName: "completeCCTP",
			args: [flow.cctpMessage, flow.cctpAttestation],
			account: relayerAccount(),
		});
		return "ready";
	} catch (error) {
		const name = claimErrorName(error);
		if (name === "NameNotRenewable" || name === "InsufficientAmount") {
			await markUnclaimed(flowId, name === "NameNotRenewable" ? "name_not_renewable" : "amount_below_policy");
			return "unclaimed";
		}
		if (new Set(["InvalidCCTPMessage", "InvalidWallet", "UnexpectedMintAmount", "InvalidLabel", "InvalidOracleConfig"]).has(name ?? "")) {
			await setFlowStatus(flowId, "failed", { lastErrorCode: name }, "invalid_claim_configuration");
			throw new FatalError(`The CCTP claim configuration is invalid: ${name}.`);
		}
		throw error;
	}
}

export async function prepareCctpClaim(flowId: string): Promise<string> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow?.cctpMessage || !flow.cctpAttestation) throw new Error("The attested CCTP message is missing.");
	if (flow.claimIntentId) {
		const [intent] = await database().select({ status: transactionIntents.status })
			.from(transactionIntents).where(eq(transactionIntents.id, flow.claimIntentId));
		return claimIntentAction(intent?.status) === "retry"
			? retryTransaction(flow.claimIntentId)
			: flow.claimIntentId;
	}
	return prepareTransaction({
		flowId,
		kind: "claim",
		chain: HUB_CHAIN,
		to: HUB_CHAIN.gatewayAddress! as Address,
		callData: encodeCompleteCctp(flow.cctpMessage, flow.cctpAttestation),
	});
}

export async function confirmCctpClaim(
	flowId: string,
	intentId: string,
): Promise<"queued" | "waiting" | "unclaimed" | "settled" | "cancelled" | "failed"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "cancelled") return "cancelled";
	if (flow.status === "settled" && flow.claimIntentStatus === "confirmed") return "settled";
	const receipt = await pollTransactionReceipt(intentId);
	if (receipt === "queued") return "queued";
	if (!receipt) return "waiting";
	if (!flow.cctpNonce || !flow.amountProcessed) throw new Error("The CCTP claim evidence is missing.");
	const settlement = receipt.status === "success"
		? parseClaimReceipt(receiptLogs(receipt.logs), {
			originChainId: flow.originChainId,
			wallet: flow.depositAddress,
			label: flow.label,
			labelHash: labelHash(flow.label) as Hex,
			amount: BigInt(flow.amountProcessed),
			nonce: `0x${BigInt(flow.cctpNonce).toString(16).padStart(64, "0")}` as Hex,
		})
		: undefined;
	const expiryAfter = receipt.status === "success"
		? await readReceiptEnsExpiry(receiptLogs(receipt.logs), flow.label, receipt.blockNumber)
		: undefined;
	const now = new Date();
	const outcome = await database().transaction(async (tx) => {
		await tx.execute(cctpIdentityLockSql(String(flow.originChainId), flow.cctpNonce!));
		const [current] = await tx.select({
			status: flows.status,
			claimTxIntentId: flows.claimTxIntentId,
			cctpNonce: flows.cctpNonce,
			cctpMessage: flows.cctpMessage,
		}).from(flows)
			.where(eq(flows.id, flowId))
			.for("update");
		if (!current) throw new Error("The flow does not exist.");
		if (current.status === "cancelled") return "cancelled" as const;
		if (current.status === "failed") return "failed" as const;
		if (
			current.claimTxIntentId !== intentId
			|| current.cctpNonce !== flow.cctpNonce
			|| current.cctpMessage?.toLowerCase() !== flow.cctpMessage?.toLowerCase()
		) {
			return current.status === "settled" ? "settled" as const : "stale" as const;
		}
		const [intent] = await tx.select({
			currentTxHash: transactionIntents.currentTxHash,
			attempts: transactionIntents.attempts,
			nonce: transactionIntents.nonce,
		}).from(transactionIntents)
			.where(eq(transactionIntents.id, intentId))
			.for("update");
		if (!intent) throw new Error("The transaction intent does not exist.");
		if (!transactionReceiptMatchesCurrentNonce(intent, receipt.transactionHash)) return "stale" as const;
		if (receipt.status !== "success") {
			await tx.update(transactionIntents).set({
				status: "reverted",
				confirmedAt: now,
				receipt: receipt as unknown as Record<string, unknown>,
				updatedAt: now,
			}).where(eq(transactionIntents.id, intentId));
			if (current.status === "settled") return "settled" as const;
			await tx.update(flows).set({
				status: "unclaimed",
				holdReason: "claim_reverted",
				lastErrorCode: "claim_reverted",
				nextActionAt: new Date(now.getTime() + UNCLAIMED_RETRY_MS),
				workflowRunId: null,
				unclaimedAt: now,
				updatedAt: now,
			}).where(eq(flows.id, flowId));
			if (current.status !== "unclaimed") {
				await tx.insert(flowTransitions).values({
					flowId,
					fromStatus: current.status,
					toStatus: "unclaimed",
					actor: "workflow",
					reasonCode: "claim_reverted",
				});
			}
			return "unclaimed" as const;
		}
		await tx.update(transactionIntents).set({
			status: "confirmed",
			confirmedAt: now,
			receipt: receipt as unknown as Record<string, unknown>,
			updatedAt: now,
		}).where(eq(transactionIntents.id, intentId));
		if (current.status === "settled") {
			await tx.update(flows).set({ workflowRunId: null, updatedAt: now }).where(eq(flows.id, flowId));
			return "settled" as const;
		}
		await tx.update(flows).set({
			status: "settled",
			gasAllowance: settlement!.gasAllowance.toString(),
			amountApplied: settlement!.amountApplied.toString(),
			durationSeconds: settlement!.durationSeconds.toString(),
			expiryAfter,
			holdReason: null,
			lastErrorCode: null,
			nextActionAt: null,
			workflowRunId: null,
			settledAt: now,
			updatedAt: now,
		}).where(eq(flows.id, flowId));
		await tx.update(names).set({ currentExpiry: expiryAfter!, ensSyncedAt: now })
			.where(and(
				eq(names.id, flow.nameId),
				or(isNull(names.currentExpiry), lt(names.currentExpiry, expiryAfter!)),
			));
		if (flow.depositEventId) {
			await tx.update(deposits).set({ status: "finalized" }).where(eq(deposits.eventId, flow.depositEventId));
		}
		await tx.insert(flowTransitions).values({
			flowId,
			fromStatus: current.status,
			toStatus: "settled",
			actor: "workflow",
				detail: {
					amountApplied: settlement!.amountApplied.toString(),
					durationSeconds: settlement!.durationSeconds.toString(),
				},
			});
		return "settled" as const;
	});
	return outcome === "stale" ? "waiting" : outcome;
}

export async function broadcastCctpTransaction(intentId: string): Promise<string> {
	"use step";
	return ensureTransactionBroadcast(intentId);
}
