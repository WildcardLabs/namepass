import { and, eq, isNull, lt, or } from "drizzle-orm";
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
import { setFlowStatus } from "./flow-state";
import { parseEnsRenewalExpiry } from "./ens-renewal";
import {
	ensureTransactionBroadcast,
	prepareTransaction,
	readTransactionReceipt,
	relayerAccount,
	retryTransaction,
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
	depositCanonical: boolean | null;
	depositStatus: typeof deposits.$inferSelect.status | null;
	depositAmount: string | null;
	originChainId: number;
	amountDetected: string;
	amountProcessed: string | null;
	remainingAmount: string | null;
	originIntentId: string | null;
	originIntentStatus: typeof transactionIntents.$inferSelect.status | null;
	claimIntentId: string | null;
	claimIntentStatus: typeof transactionIntents.$inferSelect.status | null;
	cctpNonce: string | null;
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
		const log = value as { address: Address; data: Hex; topics: readonly Hex[] };
		return { address: log.address, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] };
	});
}

export async function loadCctpFlow(flowId: string): Promise<CctpFlow | undefined> {
	"use step";
	const originIntent = alias(transactionIntents, "cctp_origin_intent");
	const claimIntent = alias(transactionIntents, "cctp_claim_intent");
	const [row] = await database()
		.select({
			flow: flows,
			name: names,
			deposit: deposits,
			event: chainEvents,
			originIntentStatus: originIntent.status,
			claimIntentStatus: claimIntent.status,
		})
		.from(flows)
		.innerJoin(names, eq(flows.nameId, names.id))
		.leftJoin(deposits, eq(flows.depositEventId, deposits.eventId))
		.leftJoin(chainEvents, eq(deposits.eventId, chainEvents.eventId))
		.leftJoin(originIntent, eq(flows.originTxIntentId, originIntent.id))
		.leftJoin(claimIntent, eq(flows.claimTxIntentId, claimIntent.id))
		.where(eq(flows.id, flowId));
	if (!row) return undefined;
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
		depositCanonical: row.event?.canonical ?? null,
		depositStatus: row.deposit?.status ?? null,
		depositAmount: row.deposit?.amount ?? null,
		originChainId: Number(row.flow.originChainId),
		amountDetected: row.flow.amountDetected,
		amountProcessed: row.flow.amountProcessed,
		remainingAmount: row.flow.remainingAmount,
		originIntentId: row.flow.originTxIntentId,
		originIntentStatus: row.originIntentStatus,
		claimIntentId: row.flow.claimTxIntentId,
		claimIntentStatus: row.claimIntentStatus,
		cctpNonce: row.flow.cctpNonce,
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
		await setFlowStatus(flowId, "cancelled", {}, "deposit_orphaned");
		return "cancelled";
	}
	await setFlowStatus(flowId, "confirming_deposit");
	const chain = originChain(flow);
	const rpc = await verifiedChainClient(chain);
	const [receipt, transaction] = await Promise.all([
		rpc.getTransactionReceipt({ hash: flow.depositTxHash }),
		chain.key === "arc" ? rpc.getTransaction({ hash: flow.depositTxHash }) : Promise.resolve(undefined),
	]);
	if (receipt.status !== "success") {
		await setFlowStatus(flowId, "cancelled", {}, "deposit_not_canonical");
		return "cancelled";
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
		await setFlowStatus(flowId, "cancelled", {}, "deposit_not_canonical");
		return "cancelled";
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
		await setFlowStatus(flowId, "cancelled", {}, "deposit_not_to_wallet");
		return "cancelled";
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
	const [ens, balance] = await Promise.all([
		readEnsState(flow.label),
		rpc.readContract({
			address: chain.usdcAddress as Address,
			abi: ERC20_ABI,
			functionName: "balanceOf",
			args: [flow.depositAddress],
			authorizationList: undefined,
		}),
	]);
	if (!ens.renewableBy) {
		await setFlowStatus(flowId, "held", { holdReason: "name_not_renewable" }, "name_not_renewable");
		return "held";
	}
	if (balance === 0n) {
		await setFlowStatus(flowId, "cancelled", {}, "empty_wallet");
		return "cancelled";
	}
	return "ready";
}

export async function simulateCctpOrigin(flowId: string): Promise<void> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	const chain = originChain(flow);
	const rpc = await verifiedChainClient(chain);
	await rpc.simulateContract({
		address: chain.factoryAddress! as Address,
		abi: FACTORY_ABI,
		functionName: "renew",
		args: [flow.label],
		account: relayerAccount(),
	});
}

export async function prepareCctpOrigin(flowId: string): Promise<string> {
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
	return prepareTransaction({
		flowId,
		kind: "origin_renew",
		chain,
		to: chain.factoryAddress! as Address,
		callData: encodeFunctionData({ abi: FACTORY_ABI, functionName: "renew", args: [flow.label] }),
	});
}

async function markCctpOriginReverted(
	flowId: string,
	intentId: string,
	receipt: Record<string, unknown>,
): Promise<void> {
	await database().transaction(async (tx) => {
		const [flow] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, flowId));
		if (!flow) throw new Error("The flow does not exist.");
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
	});
}

export async function confirmCctpOrigin(
	flowId: string,
	intentId: string,
): Promise<"waiting" | "held" | "attestation"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.cctpMessage) return "attestation";
	const receipt = await readTransactionReceipt(intentId);
	if (!receipt) return "waiting";
	if (receipt.status !== "success") {
		await markCctpOriginReverted(flowId, intentId, receipt as unknown as Record<string, unknown>);
		return "held";
	}
	const burn = parseOriginBurnReceipt(receiptLogs(receipt.logs), {
		originChainId: flow.originChainId,
		wallet: flow.depositAddress,
		label: flow.label,
		labelHash: labelHash(flow.label) as Hex,
	});
	const now = new Date();
	await database().transaction(async (tx) => {
		const [current] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, flowId));
		if (!current) throw new Error("The flow does not exist.");
		await tx.update(transactionIntents).set({
			status: "confirmed",
			confirmedAt: now,
			receipt: receipt as unknown as Record<string, unknown>,
			updatedAt: now,
		}).where(eq(transactionIntents.id, intentId));
		await tx.update(flows).set({
			status: "waiting_attestation",
			amountProcessed: burn.amount.toString(),
			remainingAmount: burn.remaining.toString(),
			cctpNonce: null,
			cctpMessage: burn.message.raw,
			waitingAttestationAt: now,
			updatedAt: now,
		}).where(eq(flows.id, flowId));
		if (current.status !== "waiting_attestation") {
			await tx.insert(flowTransitions).values({
				flowId,
				fromStatus: current.status,
				toStatus: "waiting_attestation",
				actor: "workflow",
				detail: { nonce: burn.message.nonce },
			});
		}
	});
	return "attestation";
}

export async function pollCctpAttestation(flowId: string, attempt: number): Promise<IrisResult> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow?.originIntentId || !flow.cctpMessage) throw new Error("The origin CCTP message is missing.");
	if (flow.cctpAttestation) {
		return { kind: "complete", message: flow.cctpMessage, attestation: flow.cctpAttestation, status: "complete" };
	}
	const [intent] = await database().select({ txHash: transactionIntents.currentTxHash })
		.from(transactionIntents).where(eq(transactionIntents.id, flow.originIntentId));
	if (!intent?.txHash) throw new Error("The origin transaction hash is missing.");
	const chain = originChain(flow);
	const polling = chain.polling.attestation!;
	const result = await pollIris({
		baseUrl: process.env.CIRCLE_IRIS_URL ?? "",
		sourceDomain: chain.circleDomain,
		transactionHash: intent.txHash as Hex,
		attempt,
		initialDelayMs: polling.initialMs,
		maxDelayMs: polling.maxMs,
	});
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
	await setFlowStatus(flowId, "waiting_attestation", {
		cctpMessage: result.message,
		cctpNonce: BigInt(message.nonce).toString(),
		cctpAttestation: result.attestation,
		lastErrorCode: null,
		nextActionAt: null,
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
			address: HUB_CHAIN.helperAddress! as Address,
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
		to: HUB_CHAIN.helperAddress! as Address,
		callData: encodeCompleteCctp(flow.cctpMessage, flow.cctpAttestation),
	});
}

export async function confirmCctpClaim(
	flowId: string,
	intentId: string,
): Promise<"waiting" | "unclaimed" | "settled"> {
	"use step";
	const flow = await loadCctpFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "settled") return "settled";
	const receipt = await readTransactionReceipt(intentId);
	if (!receipt) return "waiting";
	if (receipt.status !== "success") {
		await database().update(transactionIntents).set({
			status: "reverted",
			confirmedAt: new Date(),
			receipt: receipt as unknown as Record<string, unknown>,
			updatedAt: new Date(),
		}).where(eq(transactionIntents.id, intentId));
		await markUnclaimed(flowId, "claim_reverted");
		return "unclaimed";
	}
	if (!flow.cctpNonce || !flow.amountProcessed) throw new Error("The CCTP claim evidence is missing.");
	const settlement = parseClaimReceipt(receiptLogs(receipt.logs), {
		originChainId: flow.originChainId,
		wallet: flow.depositAddress,
		label: flow.label,
		labelHash: labelHash(flow.label) as Hex,
		amount: BigInt(flow.amountProcessed),
		nonce: `0x${BigInt(flow.cctpNonce).toString(16).padStart(64, "0")}` as Hex,
	});
	const expiryAfter = parseEnsRenewalExpiry(receiptLogs(receipt.logs), {
		label: flow.label,
	});
	const now = new Date();
	await database().transaction(async (tx) => {
		const [current] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, flowId));
		if (!current || current.status === "settled") return;
		await tx.update(transactionIntents).set({
			status: "confirmed",
			confirmedAt: now,
			receipt: receipt as unknown as Record<string, unknown>,
			updatedAt: now,
		}).where(eq(transactionIntents.id, intentId));
		await tx.update(flows).set({
			status: "settled",
			gasAllowance: settlement.gasAllowance.toString(),
			amountApplied: settlement.amountApplied.toString(),
			durationSeconds: settlement.durationSeconds.toString(),
			expiryAfter,
			holdReason: null,
			lastErrorCode: null,
			nextActionAt: null,
			settledAt: now,
			updatedAt: now,
		}).where(eq(flows.id, flowId));
		await tx.update(names).set({ currentExpiry: expiryAfter, ensSyncedAt: now })
			.where(and(
				eq(names.id, flow.nameId),
				or(isNull(names.currentExpiry), lt(names.currentExpiry, expiryAfter)),
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
				amountApplied: settlement.amountApplied.toString(),
				durationSeconds: settlement.durationSeconds.toString(),
			},
		});
		if (BigInt(flow.remainingAmount ?? "0") > 0n) {
			await tx.insert(flows).values({
				nameId: flow.nameId,
				originChainId: String(flow.originChainId),
				trigger: "recovery",
				amountDetected: flow.remainingAmount!,
			}).onConflictDoNothing();
		}
	});
	return "settled";
}

export async function broadcastCctpTransaction(intentId: string): Promise<string> {
	"use step";
	return ensureTransactionBroadcast(intentId);
}
