import {
	decodeEventLog,
	parseAbi,
	type Hex,
	type Transaction,
	type TransactionReceipt,
} from "viem";
import { ApiError } from "../http";
import type { ChainDefinition } from "../../src/lib/chains";

export const TRANSFER_ABI = parseAbi([
	"event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export const PROCESSED_ABI = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey,address indexed wallet,uint256 amount,uint256 remaining)",
]);
export const RENEWED_ABI = parseAbi([
	"event Renewed(bytes32 indexed labelHash,address indexed wallet,address indexed executor,string label,uint64 duration,uint256 amountReceived,uint256 gasAllowance,uint256 amountApplied,uint256 remainder,bool fromCCTP)",
]);
export const CLAIMED_ABI = parseAbi([
	"event CCTPClaimed(bytes32 indexed nonce,address indexed wallet,uint32 sourceDomain,uint256 burnAmount,uint256 feeExecuted,uint256 mintedAmount)",
]);
export type VerifiedTransfer = {
	id: string;
	kind: "erc20" | "native";
	logIndex: number | null;
	amount: string;
	sender: string;
	aliasLogIndex?: number;
};
export function receiptTransfers(
	chain: Pick<ChainDefinition, "chainId" | "key" | "usdcAddress">,
	wallet: string,
	receipt: TransactionReceipt,
	transaction: Pick<Transaction, "to" | "from" | "value">,
): VerifiedTransfer[] {
	if (receipt.status !== "success")
		throw new ApiError(
			422,
			"transaction_reverted",
			"The transaction reverted.",
		);
	const native =
		chain.key === "arc" &&
		transaction.to?.toLowerCase() === wallet.toLowerCase() &&
		transaction.value > 0n;
	if (native && transaction.value % 1000000000000n !== 0n)
		throw new ApiError(
			422,
			"unsupported_native_precision",
			"The native value is not an exact USDC amount.",
		);
	const tokens = receipt.logs.flatMap((log) => {
		if (log.address.toLowerCase() !== chain.usdcAddress.toLowerCase())
			return [];
		try {
			const { args } = decodeEventLog({
				abi: TRANSFER_ABI,
				...log,
				strict: true,
			});
			if (args.to.toLowerCase() !== wallet.toLowerCase() || args.value === 0n)
				return [];
			return [
				{
					id: `${chain.chainId}:log_${receipt.transactionHash.toLowerCase()}_${log.logIndex}`,
					kind: "erc20" as const,
					logIndex: log.logIndex,
					amount: args.value.toString(),
					sender: args.from.toLowerCase(),
				},
			];
		} catch {
			return [];
		}
	});
	if (!native) return tokens;
	const value = (transaction.value / 1000000000000n).toString();
	// Arc's native/token interface can describe the same top-level value. The native
	// transaction is its canonical identity; other logs remain distinct transfers.
	const equivalents = tokens.filter(
		(t) => t.sender === transaction.from.toLowerCase() && t.amount === value,
	);
	if (equivalents.length > 1)
		throw new ApiError(
			409,
			"ambiguous_native_evidence",
			"The native and token representations need reconciliation.",
		);
	return [
		{
			id: `${chain.chainId}:native:${receipt.transactionHash.toLowerCase()}`,
			kind: "native",
			logIndex: null,
			amount: value,
			sender: transaction.from.toLowerCase(),
			...(equivalents[0] ? { aliasLogIndex: equivalents[0].logIndex! } : {}),
		},
		...tokens.filter((t) => !equivalents.includes(t)),
	];
}
export function selectTransfer(
	candidates: VerifiedTransfer[],
	kind: string,
	logIndex: number | null,
): VerifiedTransfer {
	const matches = candidates.filter(
		(t) =>
			(t.kind === kind ||
				(kind === "erc20" &&
					t.kind === "native" &&
					t.aliasLogIndex !== undefined)) &&
			(logIndex === null ||
				t.logIndex === logIndex ||
				t.aliasLogIndex === logIndex),
	);
	if (!matches.length)
		throw new ApiError(
			422,
			"transfer_not_found",
			"No supported transfer matches this name and selection.",
		);
	if (matches.length !== 1)
		throw new ApiError(
			409,
			"selection_required",
			"Choose one transfer using its logIndex.",
			{ candidates: matches },
		);
	return matches[0];
}
export type Position = {
	blockNumber: string;
	transactionIndex: number;
	logIndex: number | null;
};
export function comparePosition(a: Position, b: Position): number {
	const delta = BigInt(a.blockNumber) - BigInt(b.blockNumber);
	return delta < 0n
		? -1
		: delta > 0n
			? 1
			: a.transactionIndex - b.transactionIndex ||
				(a.logIndex ?? -1) - (b.logIndex ?? -1);
}
export function consumptionEvidence(
	deposit: Position,
	processing: Array<
		Position & { flowId: string | null; remaining: string; finalized: boolean }
	>,
	covered: boolean,
) {
	const after = processing
		.filter((p) => comparePosition(p, deposit) > 0)
		.sort(comparePosition);
	const drain = after.findIndex((p) => p.remaining === "0");
	const candidates = drain < 0 ? after : after.slice(0, drain + 1);
	const flowIds = [
		...new Set(candidates.flatMap((p) => (p.flowId ? [p.flowId] : []))),
	];
	const proven = covered && drain >= 0 && candidates.every((p) => p.flowId);
	return {
		flowIds,
		linkage: "pooled" as const,
		allocationAmounts: null,
		status: proven
			? candidates.every((p) => p.finalized)
				? "completed"
				: "consumed"
			: after.length
				? "unresolved"
				: "pending",
		reason: !covered
			? "coverage_incomplete"
			: candidates.some((p) => !p.flowId)
				? "processing_flow_unresolved"
				: drain < 0
					? "full_drain_not_proven"
					: null,
	};
}
export type ReceiptIdentity = {
	chainId: string;
	txHash: Hex;
	blockNumber: string;
	blockHash: Hex;
	transactionIndex: number;
	logIndex: number | null;
};
export function identity(
	chainId: number,
	receipt: TransactionReceipt,
	logIndex: number | null,
): ReceiptIdentity {
	return {
		chainId: String(chainId),
		txHash: receipt.transactionHash,
		blockNumber: receipt.blockNumber.toString(),
		blockHash: receipt.blockHash,
		transactionIndex: receipt.transactionIndex,
		logIndex,
	};
}
