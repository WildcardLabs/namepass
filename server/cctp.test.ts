import assert from "node:assert/strict";
import test from "node:test";
import {
	concatHex,
	encodeAbiParameters,
	encodeEventTopics,
	numberToHex,
	padHex,
	parseAbi,
	stringToHex,
	type Address,
	type Hex,
} from "viem";

import { chainByKey, HUB_CHAIN } from "../src/lib/chains";
import { parseOriginBurnReceipt, validateCctpMessage } from "../workflows/cctp";

const depositAbi = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey, address indexed wallet, uint256 amount, uint256 remaining)",
]);
const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const wallet = "0x1111111111111111111111111111111111111111" as Address;
const labelHash = `0x${"22".repeat(32)}` as Hex;
const nonce = `0x${"33".repeat(32)}` as Hex;
const zeroNonce = `0x${"00".repeat(32)}` as Hex;

function word(value: bigint | string): Hex {
	return typeof value === "bigint"
		? numberToHex(value, { size: 32 })
		: padHex(value as Hex, { size: 32 });
}

function message(overrides: { recipient?: Address; label?: string; nonce?: Hex; executed?: number } = {}): Hex {
	const origin = chainByKey("base");
	return concatHex([
		numberToHex(1, { size: 4 }),
		numberToHex(origin.circleDomain, { size: 4 }),
		numberToHex(HUB_CHAIN.circleDomain, { size: 4 }),
		overrides.nonce ?? nonce,
		word(origin.tokenMessengerAddress!),
		word(overrides.recipient ?? HUB_CHAIN.tokenMessengerAddress!),
		word(HUB_CHAIN.gatewayAddress!),
		numberToHex(2_000, { size: 4 }),
		numberToHex(overrides.executed ?? 2_000, { size: 4 }),
		numberToHex(1, { size: 4 }),
		word(origin.usdcAddress),
		word(HUB_CHAIN.gatewayAddress!),
		word(1_000_000n),
		word(wallet),
		word(0n),
		word(0n),
		word(0n),
		stringToHex(overrides.label ?? "vitalik"),
	]);
}

test("CCTP route validation binds the route, amount, wallet, nonce, and label", () => {
	const parsed = validateCctpMessage(message(), {
		originChainId: chainByKey("base").chainId,
		wallet,
		label: "vitalik",
		amount: 1_000_000n,
		nonce,
	});
	assert.equal(parsed.label, "vitalik");
	assert.equal(parsed.amount, 1_000_000n);

	assert.throws(
		() =>
			validateCctpMessage(message({ recipient: wallet }), {
				originChainId: chainByKey("base").chainId,
				wallet,
				label: "vitalik",
			}),
		/recipient/,
	);
});

test("the origin receipt links one deposit to one Circle message", () => {
	const origin = chainByKey("base");
	const rawMessage = message({ nonce: zeroNonce, executed: 0 });
	const depositTopics = encodeEventTopics({
		abi: depositAbi,
		eventName: "DepositProcessed",
		args: { labelKey: labelHash, wallet },
	}) as [Hex, ...Hex[]];
	const messageTopics = encodeEventTopics({ abi: messageAbi, eventName: "MessageSent" }) as [Hex, ...Hex[]];
	const parsed = parseOriginBurnReceipt(
		[
			{
				address: origin.messageTransmitterAddress as Address,
				topics: messageTopics,
				data: encodeAbiParameters([{ type: "bytes" }], [rawMessage]),
				logIndex: 10,
			},
			{
				address: origin.factoryAddress! as Address,
				topics: depositTopics,
				data: encodeAbiParameters(
					[{ type: "uint256" }, { type: "uint256" }],
					[1_000_000n, 250_000n],
				),
				logIndex: 12,
			},
		],
		{
			originChainId: origin.chainId,
			wallet,
			label: "vitalik",
			labelHash,
			amount: 1_000_000n,
		},
	);
	assert.equal(parsed.message.nonce, zeroNonce);
	assert.equal(parsed.messageIndex, 0);
	assert.equal(parsed.remaining, 250_000n);
});

test("an exact DepositProcessed log selects its Circle message in a batched transaction", () => {
	const origin = chainByKey("base");
	const rawMessage = message({ nonce: zeroNonce, executed: 0 });
	const depositTopics = encodeEventTopics({
		abi: depositAbi,
		eventName: "DepositProcessed",
		args: { labelKey: labelHash, wallet },
	}) as [Hex, ...Hex[]];
	const messageTopics = encodeEventTopics({ abi: messageAbi, eventName: "MessageSent" }) as [Hex, ...Hex[]];
	const messageLog = (logIndex: number) => ({
		address: origin.messageTransmitterAddress as Address,
		topics: messageTopics,
		data: encodeAbiParameters([{ type: "bytes" }], [rawMessage]),
		logIndex,
	});
	const depositLog = (logIndex: number, remaining: bigint) => ({
		address: origin.factoryAddress! as Address,
		topics: depositTopics,
		data: encodeAbiParameters(
			[{ type: "uint256" }, { type: "uint256" }],
			[1_000_000n, remaining],
		),
		logIndex,
	});

	const parsed = parseOriginBurnReceipt(
		[messageLog(10), depositLog(12, 1_000_000n), messageLog(20), depositLog(22, 0n)],
		{
			originChainId: origin.chainId,
			wallet,
			label: "vitalik",
			labelHash,
			depositLogIndex: 22,
		},
	);
	assert.equal(parsed.messageIndex, 1);
	assert.equal(parsed.remaining, 0n);
});

test("a final Circle message rejects the origin nonce placeholder", () => {
	assert.throws(
		() => validateCctpMessage(message({ nonce: zeroNonce }), {
			originChainId: chainByKey("base").chainId,
			wallet,
			label: "vitalik",
		}),
		/nonce placeholder/,
	);
});
