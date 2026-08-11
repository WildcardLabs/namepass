import {
	decodeEventLog,
	encodeFunctionData,
	getAddress,
	hexToBigInt,
	hexToString,
	parseAbi,
	sliceHex,
	type Address,
	type Hex,
} from "viem";

import { chainById, HUB_CHAIN } from "../src/lib/chains";

const depositAbi = parseAbi([
	"event DepositProcessed(bytes32 indexed labelKey, address indexed wallet, uint256 amount, uint256 remaining)",
]);
const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const claimAbi = parseAbi([
	"event CCTPClaimed(bytes32 indexed nonce, address indexed wallet, uint32 sourceDomain, uint256 burnAmount, uint256 feeExecuted, uint256 mintedAmount)",
	"event Renewed(bytes32 indexed labelHash, address indexed wallet, address indexed executor, string label, uint64 duration, uint256 amountReceived, uint256 gasAllowance, uint256 amountApplied, uint256 remainder, bool fromCCTP)",
]);
const helperAbi = parseAbi(["function completeCCTP(bytes message, bytes attestation)"]);

const HEX = /^0x(?:[0-9a-f]{2})+$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const MESSAGE_BYTES = 376;

export interface ReceiptLog {
	address: Address;
	data: Hex;
	topics: [Hex, ...Hex[]];
}

export interface CctpMessage {
	raw: Hex;
	version: number;
	sourceDomain: number;
	destinationDomain: number;
	nonce: Hex;
	sender: Address;
	recipient: Address;
	destinationCaller: Address;
	minFinalityThreshold: number;
	finalityThresholdExecuted: number;
	burnVersion: number;
	burnToken: Address;
	mintRecipient: Address;
	amount: bigint;
	messageSender: Address;
	feeExecuted: bigint;
	label: string;
}

export interface ExpectedCctpRoute {
	originChainId: number;
	wallet: Address;
	label: string;
	amount?: bigint;
	nonce?: Hex;
}

export interface OriginBurn {
	message: CctpMessage;
	amount: bigint;
	remaining: bigint;
}

function fail(message: string): never {
	throw new Error(`Invalid CCTP data: ${message}`);
}

function sameAddress(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

function uint32(message: Hex, offset: number): number {
	return Number(hexToBigInt(sliceHex(message, offset, offset + 4)));
}

function addressWord(message: Hex, offset: number): Address {
	const value = sliceHex(message, offset, offset + 32);
	if (!/^0x0{24}[0-9a-f]{40}$/i.test(value)) fail(`address padding at byte ${offset}`);
	return getAddress(`0x${value.slice(-40)}`);
}

export function parseCctpMessage(raw: Hex): CctpMessage {
	if (!HEX.test(raw) || (raw.length - 2) / 2 < MESSAGE_BYTES) fail("message length");
	let label: string;
	try {
		label = hexToString(sliceHex(raw, MESSAGE_BYTES), { size: undefined });
	} catch {
		return fail("hook label encoding");
	}
	return {
		raw,
		version: uint32(raw, 0),
		sourceDomain: uint32(raw, 4),
		destinationDomain: uint32(raw, 8),
		nonce: sliceHex(raw, 12, 44),
		sender: addressWord(raw, 44),
		recipient: addressWord(raw, 76),
		destinationCaller: addressWord(raw, 108),
		minFinalityThreshold: uint32(raw, 140),
		finalityThresholdExecuted: uint32(raw, 144),
		burnVersion: uint32(raw, 148),
		burnToken: addressWord(raw, 152),
		mintRecipient: addressWord(raw, 184),
		amount: hexToBigInt(sliceHex(raw, 216, 248)),
		messageSender: addressWord(raw, 248),
		feeExecuted: hexToBigInt(sliceHex(raw, 312, 344)),
		label,
	};
}

export function validateCctpMessage(raw: Hex, expected: ExpectedCctpRoute): CctpMessage {
	const origin = chainById(expected.originChainId);
	if (!origin || origin.key === "ethereum" || !origin.tokenMessengerAddress) {
		fail("origin chain");
	}
	if (!HUB_CHAIN.tokenMessengerAddress || !HUB_CHAIN.helperAddress) {
		fail("destination configuration");
	}
	const message = parseCctpMessage(raw);
	if (message.version !== 1 || message.burnVersion !== 1) fail("message version");
	if (message.sourceDomain !== origin.circleDomain) fail("source domain");
	if (message.destinationDomain !== HUB_CHAIN.circleDomain) fail("destination domain");
	if (!sameAddress(message.sender, origin.tokenMessengerAddress)) fail("sender");
	if (!sameAddress(message.recipient, HUB_CHAIN.tokenMessengerAddress)) fail("recipient");
	if (!sameAddress(message.destinationCaller, HUB_CHAIN.helperAddress)) fail("destination caller");
	if (message.minFinalityThreshold !== origin.circleFinalityThreshold || message.finalityThresholdExecuted < message.minFinalityThreshold) {
		fail("finality threshold");
	}
	if (!sameAddress(message.burnToken, origin.usdcAddress)) fail("burn token");
	if (!sameAddress(message.mintRecipient, HUB_CHAIN.helperAddress)) fail("mint recipient");
	if (!sameAddress(message.messageSender, expected.wallet)) fail("wallet");
	if (message.label !== expected.label) fail("label");
	if (expected.amount !== undefined && message.amount !== expected.amount) fail("amount");
	if (expected.nonce && message.nonce.toLowerCase() !== expected.nonce.toLowerCase()) fail("nonce");
	if (message.feeExecuted > message.amount) fail("fee");
	return message;
}

function decodedLogs(
	logs: readonly ReceiptLog[],
	address: string,
	abi: typeof depositAbi | typeof messageAbi | typeof claimAbi,
): Array<{ eventName: string; args: unknown }> {
	return logs.flatMap((log) => {
		if (!sameAddress(log.address, address)) return [];
		try {
			return [decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }) as {
				eventName: string;
				args: unknown;
			}];
		} catch {
			return [];
		}
	});
}

export function parseOriginBurnReceipt(
	logs: readonly ReceiptLog[],
	expected: ExpectedCctpRoute & { labelHash: Hex },
): OriginBurn {
	const origin = chainById(expected.originChainId);
	if (!origin?.factoryAddress) fail("factory configuration");
	const deposits = decodedLogs(logs, origin.factoryAddress, depositAbi).filter(
		(log) => log.eventName === "DepositProcessed",
	);
	const sent = decodedLogs(logs, origin.messageTransmitterAddress, messageAbi).filter(
		(log) => log.eventName === "MessageSent",
	);
	if (deposits.length !== 1) fail("DepositProcessed count");
	if (sent.length !== 1) fail("MessageSent count");

	const deposit = deposits[0].args as {
		labelKey: Hex;
		wallet: Address;
		amount: bigint;
		remaining: bigint;
	};
	if (!HASH.test(expected.labelHash) || deposit.labelKey.toLowerCase() !== expected.labelHash.toLowerCase()) {
		fail("label hash");
	}
	if (!sameAddress(deposit.wallet, expected.wallet)) fail("deposit wallet");
	if (expected.amount !== undefined && deposit.amount !== expected.amount) fail("deposit amount");

	const message = validateCctpMessage((sent[0].args as { message: Hex }).message, {
		...expected,
		amount: deposit.amount,
	});
	return { message, amount: deposit.amount, remaining: deposit.remaining };
}

export function encodeCompleteCctp(message: Hex, attestation: Hex): Hex {
	if (!HEX.test(message) || !HEX.test(attestation)) fail("claim bytes");
	return encodeFunctionData({ abi: helperAbi, functionName: "completeCCTP", args: [message, attestation] });
}

export interface ClaimSettlement {
	amountReceived: bigint;
	amountApplied: bigint;
	durationSeconds: bigint;
	gasAllowance: bigint;
	remaining: bigint;
}

export function parseClaimReceipt(
	logs: readonly ReceiptLog[],
	expected: ExpectedCctpRoute & { labelHash: Hex },
): ClaimSettlement {
	if (!HUB_CHAIN.helperAddress) fail("helper configuration");
	const events = decodedLogs(logs, HUB_CHAIN.helperAddress, claimAbi);
	const claimed = events.filter((event) => event.eventName === "CCTPClaimed");
	const renewed = events.filter((event) => event.eventName === "Renewed");
	if (claimed.length !== 1 || renewed.length !== 1) fail("claim event count");

	const claim = claimed[0].args as {
		nonce: Hex;
		wallet: Address;
		sourceDomain: number;
		burnAmount: bigint;
		feeExecuted: bigint;
		mintedAmount: bigint;
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
	const origin = chainById(expected.originChainId);
	if (!origin || claim.sourceDomain !== origin.circleDomain) fail("claim source domain");
	if (!expected.nonce || claim.nonce.toLowerCase() !== expected.nonce.toLowerCase()) fail("claim nonce");
	if (!sameAddress(claim.wallet, expected.wallet) || !sameAddress(renewal.wallet, expected.wallet)) {
		fail("claim wallet");
	}
	if (renewal.labelHash.toLowerCase() !== expected.labelHash.toLowerCase() || renewal.label !== expected.label) {
		fail("claim label");
	}
	if (!renewal.fromCCTP) fail("claim path");
	if (expected.amount !== undefined && claim.burnAmount !== expected.amount) fail("claim amount");
	if (claim.feeExecuted > claim.burnAmount || claim.mintedAmount !== claim.burnAmount - claim.feeExecuted) {
		fail("claim accounting");
	}
	if (renewal.amountReceived !== claim.mintedAmount) fail("renewal amount");
	return {
		amountReceived: renewal.amountReceived,
		amountApplied: renewal.amountApplied,
		durationSeconds: renewal.duration,
		gasAllowance: renewal.gasAllowance,
		remaining: renewal.remainder,
	};
}
