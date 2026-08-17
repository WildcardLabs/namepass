import assert from "node:assert/strict";
import test from "node:test";
import {
	encodeAbiParameters,
	encodeEventTopics,
	parseAbi,
	type Address,
	type Hex,
} from "viem";

import { labelHash } from "./chain";
import {
	isKnownTransactionError,
	matchesRecordedDepositTransfer,
	parseEthereumRenewalReceipt,
	reserveNonce,
} from "./ethereum";
import { originRevertFlowPatch, transactionIntentAction, withVerifiedChainClient } from "./transactions";
import { HUB_CHAIN } from "../src/lib/chains";

const DEPOSIT_PROCESSED = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey, address indexed wallet, uint256 amount, uint256 remaining)",
]);
const RENEWED = parseAbi([
	"event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)",
]);
const wallet = "0x1111111111111111111111111111111111111111" as Address;
const executor = "0x2222222222222222222222222222222222222222" as Address;
const wrongEmitter = "0x3333333333333333333333333333333333333333" as Address;
const label = "vitalik";
const labelKey = labelHash(label) as Hex;

function settlementLogs(renewalEmitter = HUB_CHAIN.helperAddress! as Address) {
	return [
		{
			address: HUB_CHAIN.factoryAddress! as Address,
			topics: encodeEventTopics({
				abi: DEPOSIT_PROCESSED,
				eventName: "DepositProcessed",
				args: { labelKey, wallet },
			}) as [Hex, ...Hex[]],
			data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1_000_000n, 0n]),
		},
		{
			address: renewalEmitter,
			topics: encodeEventTopics({
				abi: RENEWED,
				eventName: "Renewed",
				args: { labelHash: labelKey, wallet, executor },
			}) as [Hex, ...Hex[]],
			data: encodeAbiParameters(
				[
					{ type: "string" }, { type: "uint64" }, { type: "uint256" }, { type: "uint256" },
					{ type: "uint256" }, { type: "uint256" }, { type: "bool" },
				],
				[label, 100n, 1_000_000n, 100_000n, 899_000n, 1_000n, false],
			),
		},
	];
}

test("nonce reservation never moves behind the RPC pending nonce", () => {
	assert.equal(reserveNonce(12n, 8n), 12n);
	assert.equal(reserveNonce(8n, 12n), 12n);
	assert.equal(reserveNonce(12n, 12n), 12n);
});

test("a safe raw-transaction rebroadcast accepts only known-transaction responses", () => {
	assert.equal(isKnownTransactionError(new Error("already known")), true);
	assert.equal(isKnownTransactionError(new Error("already imported")), true);
	assert.equal(isKnownTransactionError(new Error("insufficient funds")), false);
});

test("Ethereum settlement ignores forged same-signature logs from another emitter", () => {
	assert.throws(
		() => parseEthereumRenewalReceipt(settlementLogs(wrongEmitter), { wallet, label, labelHash: labelKey }),
		/exactly one expected Namepass event/,
	);
	assert.deepEqual(
		parseEthereumRenewalReceipt(settlementLogs(), { wallet, label, labelHash: labelKey }),
		{
			amountProcessed: "1000000",
			remainingAmount: "0",
			gasAllowance: "100000",
			amountApplied: "899000",
			durationSeconds: "100",
		},
	);
});

test("event-backed flows require the recorded transfer amount", () => {
	assert.equal(matchesRecordedDepositTransfer({ to: wallet, value: 1_000_000n }, wallet, "1000000"), true);
	assert.equal(matchesRecordedDepositTransfer({ to: wallet, value: 999_999n }, wallet, "1000000"), false);
});

test("a mined origin revert gets a fresh nonce attempt on manual resume", () => {
	assert.equal(transactionIntentAction("reverted"), "retry");
	assert.equal(transactionIntentAction("broadcast"), "reuse");
	assert.equal(reserveNonce(13n, 12n), 13n);
	assert.deepEqual(originRevertFlowPatch(new Date("2026-08-11T00:00:00.000Z")), {
		status: "held",
		holdReason: "origin_reverted",
		lastErrorCode: "origin_reverted",
		workflowRunId: null,
		heldAt: new Date("2026-08-11T00:00:00.000Z"),
		updatedAt: new Date("2026-08-11T00:00:00.000Z"),
	});
});

test("a wrong RPC chain stops guarded simulation, signing, and broadcast work", async () => {
	const previousUrl = process.env[HUB_CHAIN.rpcEnv];
	const previousFetch = globalThis.fetch;
	let workRan = false;
	process.env[HUB_CHAIN.rpcEnv] = "https://rpc.test";
	globalThis.fetch = async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" });
	try {
		await assert.rejects(
			withVerifiedChainClient(HUB_CHAIN, async () => { workRan = true; }),
			/RPC chain ID 1 does not match 11155111/,
		);
		assert.equal(workRan, false);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousUrl === undefined) delete process.env[HUB_CHAIN.rpcEnv];
		else process.env[HUB_CHAIN.rpcEnv] = previousUrl;
	}
});
