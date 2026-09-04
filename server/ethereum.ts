import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
	decodeEventLog,
	encodeFunctionData,
	getAddress,
	parseAbi,
	type Address,
	type Hex,
} from "viem";
import { HUB_CHAIN } from "../src/lib/chains";
import { labelHash, readEnsState } from "./chain";
import { database } from "./db/client";
import { chainEvents, deposits, flows, flowTransitions, names } from "./db/schema";
import { NAME_RECHECK_MS, setFlowStatus } from "./flow-state";
import { automaticDepositBalanceBlock, depositBalanceAction } from "./deposit-eligibility";
import { parseEnsRenewalExpiry } from "./ens-renewal";
import {
	ensureTransactionBroadcast,
	prepareTransaction,
	readTransactionReceipt,
	replaceStaleTransaction,
	retryTransaction,
	transactionIntentAction,
	originRevertFlowPatch,
	verifiedChainClient,
} from "./transactions";
import { transactionIntents } from "./db/schema";

export { isKnownTransactionError, reserveNonce } from "./transactions";

const FACTORY_ABI = parseAbi(["function renew(string label)"]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const DEPOSIT_PROCESSED = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey, address indexed wallet, uint256 amount, uint256 remaining)",
]);
const RENEWED = parseAbi([
	"event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)",
]);

export type EthereumFlow = {
	id: string;
	nameId: string;
	status: string;
	trigger: typeof flows.$inferSelect.trigger;
	label: string;
	depositAddress: string;
	depositEventId: string | null;
	depositTxHash: string | null;
	depositLogIndex: number | null;
	depositBlockNumber: string | null;
	eligibilityBlockNumber: string | null;
	depositCanonical: boolean | null;
	depositStatus: string | null;
	depositAmount: string | null;
	originIntentId: string | null;
	originIntentStatus: typeof transactionIntents.$inferSelect.status | null;
};

export type ReceiptSettlement = {
	amountProcessed: string;
	remainingAmount: string;
	gasAllowance: string;
	amountApplied: string;
	durationSeconds: string;
};

export const ORIGIN_REVERTED = "origin_reverted";

type ReceiptLog = { address: Address; data: Hex; topics: readonly Hex[] };

export function matchesRecordedDepositTransfer(
	transfer: { to: Address; value: bigint },
	depositAddress: string,
	depositAmount: string | null,
): boolean {
	return depositAmount !== null
		&& getAddress(transfer.to) === getAddress(depositAddress)
		&& transfer.value === BigInt(depositAmount);
}

function decodedEvents(
	logs: readonly ReceiptLog[],
	address: Address,
	abi: typeof DEPOSIT_PROCESSED | typeof RENEWED,
) {
	return logs.flatMap((log) => {
		if (getAddress(log.address) !== getAddress(address)) return [];
		try {
			return [decodeEventLog({
				abi,
				data: log.data,
				topics: log.topics as [Hex, ...Hex[]],
				strict: true,
			})];
		} catch {
			return [];
		}
	});
}

/** Bind settlement facts to the deployed emitters before changing durable state. */
export function parseEthereumRenewalReceipt(
	logs: readonly ReceiptLog[],
	expected: { wallet: Address; label: string; labelHash: Hex },
): ReceiptSettlement {
	if (!HUB_CHAIN.factoryAddress || !HUB_CHAIN.helperAddress) {
		throw new Error("The Ethereum Namepass deployment is incomplete.");
	}
	const processed = decodedEvents(logs, HUB_CHAIN.factoryAddress as Address, DEPOSIT_PROCESSED)
		.filter((event) => event.eventName === "DepositProcessed");
	const renewed = decodedEvents(logs, HUB_CHAIN.helperAddress as Address, RENEWED)
		.filter((event) => event.eventName === "Renewed");
	if (processed.length !== 1 || renewed.length !== 1) {
		throw new Error("The Ethereum receipt does not contain exactly one expected Namepass event.");
	}
	const deposit = processed[0].args as {
		labelKey: Hex;
		wallet: Address;
		amount: bigint;
		remaining: bigint;
	};
	const renewal = renewed[0].args as {
		labelHash: Hex;
		wallet: Address;
		label: string;
		duration: bigint;
		amountReceived: bigint;
		gasAllowance: bigint;
		amountApplied: bigint;
		remainder: bigint;
		fromCCTP: boolean;
	};
	if (
		deposit.labelKey.toLowerCase() !== expected.labelHash.toLowerCase()
		|| getAddress(deposit.wallet) !== getAddress(expected.wallet)
		|| renewal.labelHash.toLowerCase() !== expected.labelHash.toLowerCase()
		|| getAddress(renewal.wallet) !== getAddress(expected.wallet)
		|| renewal.label !== expected.label
		|| renewal.fromCCTP
		|| renewal.amountReceived !== deposit.amount
		|| renewal.gasAllowance > renewal.amountReceived
		|| renewal.amountApplied > renewal.amountReceived - renewal.gasAllowance
		|| renewal.remainder !== renewal.amountReceived - renewal.gasAllowance - renewal.amountApplied
	) {
		throw new Error("The Ethereum receipt does not match the expected renewal.");
	}
	return {
		amountProcessed: deposit.amount.toString(),
		remainingAmount: deposit.remaining.toString(),
		gasAllowance: renewal.gasAllowance.toString(),
		amountApplied: renewal.amountApplied.toString(),
		durationSeconds: renewal.duration.toString(),
	};
}

async function setStatus(
	flowId: string,
	toStatus: "confirming_deposit" | "checking_name" | "submitting_origin" | "waiting_origin" | "held" | "settled" | "cancelled" | "failed",
	reasonCode?: string,
	detail?: Record<string, unknown>,
): Promise<void> {
	await setFlowStatus(flowId, toStatus, {}, reasonCode, detail);
}

export async function loadEthereumFlow(flowId: string): Promise<EthereumFlow | undefined> {
	"use step";
	const originIntent = alias(transactionIntents, "ethereum_origin_intent");
	const rows = await database()
		.select({
			flow: flows,
			name: names,
			deposit: deposits,
			event: chainEvents,
			originIntentStatus: originIntent.status,
		})
		.from(flows)
		.innerJoin(names, eq(flows.nameId, names.id))
		.leftJoin(deposits, eq(flows.depositEventId, deposits.eventId))
		.leftJoin(chainEvents, eq(deposits.eventId, chainEvents.eventId))
		.leftJoin(originIntent, eq(flows.originTxIntentId, originIntent.id))
		.where(eq(flows.id, flowId));
	const row = rows[0];
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
		depositAddress: row.name.depositAddress,
		depositEventId: row.flow.depositEventId,
		depositTxHash: row.deposit?.txHash ?? null,
		depositLogIndex: row.deposit?.logIndex ?? null,
		depositBlockNumber: row.deposit?.blockNumber ?? null,
		eligibilityBlockNumber,
		depositCanonical: row.event?.canonical ?? null,
		depositStatus: row.deposit?.status ?? null,
		depositAmount: row.deposit?.amount ?? null,
		originIntentId: row.flow.originTxIntentId,
		originIntentStatus: row.originIntentStatus,
	};
}

/** Validate the mined transfer before the same-chain renewal spends it. */
export async function confirmEthereumDeposit(flowId: string): Promise<"ready" | "cancelled"> {
	"use step";
	const flow = await loadEthereumFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "settled") return "ready";
	if (flow.status === "cancelled") return "cancelled";
	// Manual and balance-recovery flows have no single transfer event to wait for.
	if (!flow.depositTxHash || flow.depositLogIndex === null) return "ready";
	if (!flow.depositCanonical || flow.depositStatus === "orphaned") {
		await setStatus(flowId, "cancelled", "deposit_orphaned");
		return "cancelled";
	}
	await setStatus(flowId, "confirming_deposit");
	const rpc = await verifiedChainClient(HUB_CHAIN);
	const receipt = await rpc.getTransactionReceipt({ hash: flow.depositTxHash as Hex });
	if (
		receipt.status !== "success"
		|| (flow.depositBlockNumber !== null && receipt.blockNumber !== BigInt(flow.depositBlockNumber))
	) {
		await setStatus(flowId, "cancelled", "deposit_not_canonical");
		return "cancelled";
	}
	const log = receipt.logs.find((candidate) => candidate.logIndex === flow.depositLogIndex);
	if (!log || getAddress(log.address) !== getAddress(HUB_CHAIN.usdcAddress)) {
		await setStatus(flowId, "cancelled", "deposit_not_canonical");
		return "cancelled";
	}
	const transfer = decodeEventLog({
		abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]),
		data: log.data,
		topics: (log as unknown as { topics: [Hex, ...Hex[]] }).topics,
	}) as { eventName: "Transfer"; args: { to: Address; value: bigint } };
	if (transfer.eventName !== "Transfer" || !matchesRecordedDepositTransfer(
		transfer.args,
		flow.depositAddress,
		flow.depositAmount,
	)) {
		await setStatus(flowId, "cancelled", "deposit_not_to_wallet");
		return "cancelled";
	}
	return "ready";
}

export async function checkEthereumEligibility(flowId: string): Promise<"ready" | "held" | "cancelled"> {
	"use step";
	const flow = await loadEthereumFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "settled") return "ready";
	if (flow.status === "cancelled") return "cancelled";
	await setStatus(flowId, "checking_name");
	const rpc = await verifiedChainClient(HUB_CHAIN);
	const balanceBlock = flow.eligibilityBlockNumber !== null
		? BigInt(flow.eligibilityBlockNumber)
		: undefined;
	const [ens, balance] = await Promise.all([
		readEnsState(flow.label),
		rpc.readContract({
			address: HUB_CHAIN.usdcAddress as Address,
			abi: ERC20_ABI,
			functionName: "balanceOf",
			args: [flow.depositAddress as Address],
			authorizationList: undefined,
			blockNumber: balanceBlock,
		}),
	]);
	if (!ens.renewableBy) {
		await setFlowStatus(
			flowId,
			"held",
			{
				holdReason: "name_not_renewable",
				nextActionAt: new Date(Date.now() + NAME_RECHECK_MS),
			},
			"name_not_renewable",
		);
		return "held";
	}
	const balanceAction = depositBalanceAction(balance, balanceBlock);
	if (balanceAction !== "ready") {
		if (balanceAction === "retry") {
			throw new Error("The deposit block does not contain the verified wallet balance.");
		}
		await setStatus(flowId, "cancelled", "empty_wallet");
		return "cancelled";
	}
	return "ready";
}

/** Persist exact signed bytes before any RPC broadcast. */
export async function prepareEthereumRenewal(flowId: string): Promise<string> {
	"use step";
	const flow = await loadEthereumFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.originIntentId) {
		const [intent] = await database().select({ status: transactionIntents.status })
			.from(transactionIntents).where(eq(transactionIntents.id, flow.originIntentId));
		return transactionIntentAction(intent?.status) === "retry"
			? retryTransaction(flow.originIntentId)
			: flow.originIntentId;
	}
	const callData = encodeFunctionData({ abi: FACTORY_ABI, functionName: "renew", args: [flow.label] });
	return prepareTransaction({
		flowId,
		kind: "origin_renew",
		chain: HUB_CHAIN,
		to: HUB_CHAIN.factoryAddress! as Address,
		callData,
	});
}

export async function broadcastEthereumRenewal(intentId: string): Promise<string> {
	"use step";
	return ensureTransactionBroadcast(intentId);
}

async function markEthereumOriginReverted(
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
				reasonCode: ORIGIN_REVERTED,
			});
		}
	});
}

export async function confirmEthereumRenewal(flowId: string, intentId: string): Promise<"waiting" | "held" | "settled" | "cancelled"> {
	"use step";
	const flow = await loadEthereumFlow(flowId);
	if (!flow) throw new Error("The flow does not exist.");
	if (flow.status === "cancelled") return "cancelled";
	const receipt = await readTransactionReceipt(intentId);
	if (!receipt) {
		await replaceStaleTransaction(intentId);
		return "waiting";
	}
	if (receipt.status !== "success") {
		await markEthereumOriginReverted(flowId, intentId, receipt as unknown as Record<string, unknown>);
		return "held";
	}
	const settlement = parseEthereumRenewalReceipt(receipt.logs as ReceiptLog[], {
		wallet: flow.depositAddress as Address,
		label: flow.label,
		labelHash: labelHash(flow.label) as Hex,
	});
	const expiryAfter = parseEnsRenewalExpiry(receipt.logs as ReceiptLog[], {
		label: flow.label,
	});
	const db = database();
	await db.transaction(async (tx) => {
		const [current] = await tx.select({ status: flows.status }).from(flows).where(eq(flows.id, flowId));
		if (!current) return;
		const now = new Date();
		await tx.update(transactionIntents).set({ status: "confirmed", confirmedAt: now, receipt: receipt as unknown as Record<string, unknown>, updatedAt: now }).where(eq(transactionIntents.id, intentId));
		if (current.status === "settled") {
			await tx.update(flows).set({ originEvidenceTxHash: receipt.transactionHash, updatedAt: now }).where(eq(flows.id, flowId));
			return;
		}
		await tx.update(flows).set({ status: "settled", originEvidenceTxHash: receipt.transactionHash, amountProcessed: settlement.amountProcessed, remainingAmount: settlement.remainingAmount, gasAllowance: settlement.gasAllowance, amountApplied: settlement.amountApplied, durationSeconds: settlement.durationSeconds, expiryAfter, settledAt: now, updatedAt: now }).where(eq(flows.id, flowId));
		await tx.update(names).set({ currentExpiry: expiryAfter, ensSyncedAt: now }).where(and(
			eq(names.id, flow.nameId),
			or(isNull(names.currentExpiry), lt(names.currentExpiry, expiryAfter)),
		));
		if (flow.depositEventId) {
			await tx.update(deposits).set({ status: "finalized" }).where(eq(deposits.eventId, flow.depositEventId));
		}
		if (BigInt(settlement.remainingAmount) > 0n) {
			await tx.update(names).set({
				unscannedChainIds: sql`case
					when ${String(HUB_CHAIN.chainId)}::numeric = any(${names.unscannedChainIds})
					then ${names.unscannedChainIds}
					else array_append(${names.unscannedChainIds}, ${String(HUB_CHAIN.chainId)}::numeric)
				end`,
			}).where(eq(names.id, flow.nameId));
		}
		await tx.insert(flowTransitions).values({ flowId, fromStatus: current.status, toStatus: "settled", actor: "workflow", detail: settlement });
	});
	return "settled";
}
