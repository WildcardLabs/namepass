import { beforeEach, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { TransactionReceiptNotFoundError } from "viem";

const mocks = vi.hoisted(() => ({
	database: vi.fn(),
	setFlowStatus: vi.fn(),
	logOperation: vi.fn(),
	logWarning: vi.fn(),
	rpc: {
		getChainId: vi.fn(), getTransactionReceipt: vi.fn(), sendRawTransaction: vi.fn(),
		getTransactionCount: vi.fn(), estimateFeesPerGas: vi.fn(),
	},
}));
vi.mock("../../server/db/client", () => ({ database: mocks.database }));
vi.mock("../../server/flow-state", () => ({ setFlowStatus: mocks.setFlowStatus }));
vi.mock("../../server/log", () => ({ logOperation: mocks.logOperation, logWarning: mocks.logWarning }));
vi.mock("viem", async (original) => ({
	...await original<typeof import("viem")>(), createPublicClient: () => mocks.rpc,
}));

import { HUB_CHAIN } from "../../src/lib/chains";
import { pollTransactionReceipt, requiresReceiptLookup } from "../../server/transactions";

const hash = `0x${"1".repeat(64)}`;
const olderHash = `0x${"2".repeat(64)}`;
const previousNonceHash = `0x${"3".repeat(64)}`;
const raw = "0x1234";

function fixture() {
	return {
		id: "intent", flowId: "flow", kind: "claim", chainId: String(HUB_CHAIN.chainId),
		fromAddress: "0x1111111111111111111111111111111111111111", nonce: "9",
		status: "prepared", currentTxHash: hash, currentRawTransaction: raw,
		broadcastAt: null as Date | null, lastBroadcastAttemptAt: null as Date | null,
		pendingWarnedAt: null as Date | null, gasLimit: "100000", maxFeePerGas: "100",
		maxPriorityFeePerGas: "10", error: null as unknown,
		attempts: [{ hash, nonce: "9", broadcastAt: null as string | null }],
	};
}

let intent = fixture();
let head: () => boolean;
let updates: Array<{ patch: Record<string, unknown>; sql: string; params: unknown[] }>;
let acceptUpdate: () => boolean;

beforeEach(() => {
	vi.resetAllMocks();
	intent = fixture();
	head = () => true;
	acceptUpdate = () => true;
	updates = [];
	vi.stubEnv(HUB_CHAIN.rpcEnv, "https://rpc.invalid");
	// A generated test-only key. No signer operation occurs in these polling tests.
	vi.stubEnv("RELAYER_PRIVATE_KEY", `0x${"1".repeat(64)}`);
	mocks.rpc.getChainId.mockResolvedValue(HUB_CHAIN.chainId);
	mocks.rpc.sendRawTransaction.mockResolvedValue(hash);
	mocks.rpc.getTransactionReceipt.mockImplementation(async ({ hash: requested }) => {
		throw new TransactionReceiptNotFoundError({ hash: requested });
	});
	mocks.database.mockReturnValue({
		select: () => ({ from: () => ({ where: () => ({
			then: (resolve: (rows: unknown[]) => unknown) => resolve([structuredClone(intent)]),
			limit: async () => head() ? [] : [{ id: "earlier" }],
		}) }) }),
		update: () => ({ set: (patch: Record<string, unknown>) => ({ where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
			const query = new PgDialect().sqlToQuery(condition);
			updates.push({ patch, sql: query.sql, params: query.params });
			const accepted = acceptUpdate();
			if (accepted) {
				const values = { ...patch };
				// Model the existing coalesce write; keep SQL objects out of stored rows.
				if (values.lastBroadcastAttemptAt && !(values.lastBroadcastAttemptAt instanceof Date)) {
					values.lastBroadcastAttemptAt = intent.lastBroadcastAttemptAt ?? values.broadcastAt ?? new Date();
				}
				Object.assign(intent, values);
			}
			return { returning: async () => accepted ? [{ id: intent.id }] : [] };
		} }) }),
	});
});

test("a queued intent that has not been broadcast performs no RPC or database writes", async () => {
	head = () => false;
	for (let i = 0; i < 100; i++) expect(await pollTransactionReceipt("intent")).toBe("queued");
	for (const fn of Object.values(mocks.rpc)) expect(fn).not.toHaveBeenCalled();
	expect(updates).toEqual([]);
	expect(mocks.setFlowStatus).not.toHaveBeenCalled();
});

test("the active workflow broadcasts the same bytes when the earlier nonce finishes", async () => {
	head = () => false;
	expect(await pollTransactionReceipt("intent")).toBe("queued");
	head = () => true;
	mocks.rpc.getTransactionReceipt.mockImplementation(async () => {
		expect(mocks.rpc.sendRawTransaction).toHaveBeenCalledExactlyOnceWith({ serializedTransaction: raw });
		return { transactionHash: hash, status: "success" };
	});
	expect(await pollTransactionReceipt("intent")).toMatchObject({ transactionHash: hash });
	expect(intent.nonce).toBe("9");
	expect(intent.status).toBe("broadcast");
	expect(mocks.setFlowStatus).toHaveBeenCalledWith("flow", "waiting_claim");
});

test("broadcast repeats the nonce check if the queue changes after the poll read", async () => {
	let reads = 0;
	head = () => ++reads === 1;
	expect(await pollTransactionReceipt("intent")).toBeUndefined();
	expect(mocks.rpc.sendRawTransaction).not.toHaveBeenCalled();
	expect(intent.status).toBe("prepared");
	expect(updates).toEqual([]);
});

test("an older same-nonce attempt can settle a prepared replacement", async () => {
	intent.attempts = [
		{ hash: previousNonceHash, nonce: "8", broadcastAt: "2026-09-01T00:00:00Z" },
		{ hash: olderHash, nonce: "9", broadcastAt: "2026-09-10T11:00:00Z" },
		...intent.attempts,
	];
	mocks.rpc.getTransactionReceipt.mockImplementation(async ({ hash: requested }) => {
		if (requested === olderHash) return { transactionHash: olderHash, status: "success" };
		throw new TransactionReceiptNotFoundError({ hash: requested });
	});
	expect(await pollTransactionReceipt("intent")).toMatchObject({ transactionHash: olderHash });
	expect(mocks.rpc.getTransactionReceipt.mock.calls.map(([x]) => x.hash)).toEqual([hash, olderHash]);
	expect(mocks.rpc.sendRawTransaction).not.toHaveBeenCalled();
});

test("replacement history remains uncertain when a crash lost its broadcast timestamps", () => {
	intent.attempts.unshift({ hash: olderHash, nonce: "9", broadcastAt: null });
	expect(requiresReceiptLookup(intent)).toBe(true);
	intent.attempts = [];
	expect(requiresReceiptLookup(intent)).toBe(true);
});

test("a retry at a new nonce is not treated as already broadcast because of old history", () => {
	intent.attempts.unshift({ hash: previousNonceHash, nonce: "8", broadcastAt: "2026-09-01T00:00:00Z" });
	expect(requiresReceiptLookup(intent)).toBe(false);
});

test("a crash after send but before persistence safely rebroadcasts the exact bytes", async () => {
	mocks.rpc.sendRawTransaction.mockRejectedValue(new Error("already known"));
	mocks.rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, status: "success" });
	expect(await pollTransactionReceipt("intent")).toMatchObject({ transactionHash: hash });
	expect(mocks.rpc.sendRawTransaction).toHaveBeenCalledExactlyOnceWith({ serializedTransaction: raw });
	expect(intent.status).toBe("broadcast");
});

test("a fresh broadcast error is persisted and does not change transaction ownership", async () => {
	mocks.rpc.sendRawTransaction.mockRejectedValue(new Error("insufficient funds"));
	await expect(pollTransactionReceipt("intent")).rejects.toThrow("insufficient funds");
	expect(intent.error).toEqual({ code: "insufficient_funds" });
	expect(intent.status).toBe("prepared");
	expect(intent.nonce).toBe("9");
	expect(mocks.setFlowStatus).not.toHaveBeenCalled();
});

test("a recent rejected send checks receipts without immediate fee replacement", async () => {
	intent.lastBroadcastAttemptAt = new Date();
	expect(await pollTransactionReceipt("intent")).toBeUndefined();
	expect(mocks.rpc.getTransactionReceipt).toHaveBeenCalledOnce();
	expect(mocks.rpc.sendRawTransaction).not.toHaveBeenCalled();
	expect(mocks.rpc.estimateFeesPerGas).not.toHaveBeenCalled();
});

test("an unknown consumed nonce remains unresolved and blocks later work", async () => {
	mocks.rpc.sendRawTransaction.mockRejectedValue(new Error("nonce too low"));
	mocks.rpc.getTransactionCount.mockResolvedValue(10);
	expect(await pollTransactionReceipt("intent")).toBeUndefined();
	expect(intent.status).toBe("broadcast");
	expect(intent.error).toEqual({ code: "nonce_consumed_receipt_pending" });
	expect(mocks.logWarning).toHaveBeenCalledWith("transaction.nonce_consumed_receipt_pending", expect.anything());
	expect(mocks.rpc.estimateFeesPerGas).not.toHaveBeenCalled();
	expect(intent.nonce).toBe("9");
});

test("a concurrent receipt writer cannot be overwritten by a late broadcast", async () => {
	acceptUpdate = () => { intent.status = "confirmed"; return false; };
	mocks.rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, status: "success" });
	await pollTransactionReceipt("intent");
	expect(intent.status).toBe("confirmed");
	expect(mocks.setFlowStatus).not.toHaveBeenCalled();
	expect(updates[0].sql).toContain('"transaction_intents"."status"');
	expect(updates[0].sql).toContain('"transaction_intents"."current_tx_hash"');
	expect(updates[0].params).toEqual(["intent", hash, "prepared"]);
});

test("a known mined revert is returned to the existing business receipt handler", async () => {
	intent.status = "mined";
	mocks.rpc.getTransactionReceipt.mockResolvedValue({ transactionHash: hash, status: "reverted" });
	expect(await pollTransactionReceipt("intent")).toMatchObject({ status: "reverted" });
	expect(updates).toEqual([]);
	expect(mocks.rpc.sendRawTransaction).not.toHaveBeenCalled();
});
