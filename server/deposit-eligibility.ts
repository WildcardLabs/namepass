import { and, desc, eq, inArray, lte } from "drizzle-orm";

import { database } from "./db/client";
import { chainEvents, deposits } from "./db/schema";

export function depositBalanceAction(
	balance: bigint,
	depositBlockNumber: bigint | undefined,
): "ready" | "retry" | "cancelled" {
	if (balance > 0n) return "ready";
	return depositBlockNumber === undefined ? "cancelled" : "retry";
}

export function liveDepositBalanceAction(input: {
	verifiedBalance: bigint;
	verifiedBlock: bigint | undefined;
	liveBalance: bigint;
	liveBlock: bigint;
}): "ready" | "retry" | "cancelled" | "absorbed" {
	if (input.liveBalance > 0n) {
		return depositBalanceAction(input.verifiedBalance, input.verifiedBlock);
	}
	if (input.verifiedBlock === undefined) return "cancelled";
	/* A deposit and a full-wallet renewal can share a block. Its end-of-block
	   balance is already zero, so the later live block is the decisive fact. */
	return input.liveBlock > input.verifiedBlock ? "absorbed" : "retry";
}

/** A later full-wallet origin transaction consumed every earlier deposit. */
export function depositWasAbsorbed(input: {
	depositBlock: bigint;
	originBlock: bigint;
	remainingAmount: bigint;
}): boolean {
	return input.remainingAmount === 0n && input.originBlock > input.depositBlock;
}

/** Use the trigger deposit block for an automatic accumulated-balance flow. */
export async function automaticDepositBalanceBlock(input: {
	trigger: string;
	nameId: string;
	chainId: string;
	createdAt: Date;
	linkedBlockNumber: string | null;
}): Promise<string | null> {
	if (input.linkedBlockNumber !== null || input.trigger !== "automatic") return input.linkedBlockNumber;
	const [latest] = await database().select({ blockNumber: deposits.blockNumber })
		.from(deposits)
		.innerJoin(chainEvents, eq(deposits.eventId, chainEvents.eventId))
		.where(and(
			eq(deposits.nameId, input.nameId),
			eq(deposits.chainId, input.chainId),
			inArray(deposits.status, ["detected", "finalized"]),
			eq(chainEvents.canonical, true),
			lte(deposits.blockTime, input.createdAt),
		))
		.orderBy(desc(deposits.blockTime), desc(deposits.blockNumber))
		.limit(1);
	return latest?.blockNumber ?? null;
}
