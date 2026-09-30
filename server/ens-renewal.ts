import { decodeEventLog, getAddress, parseAbi, keccak256, stringToHex, createPublicClient, http, type Address, type Hex } from "viem";

import { HUB_CHAIN } from "../src/lib/chains";

const NAME_RENEWED = parseAbi([
	"event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);

type ReceiptLog = { address: Address; data: Hex; topics: readonly Hex[] };

/** Read the authoritative ENS expiry from the same receipt as a Namepass renewal. */
export function parseEnsRenewalExpiry(
	logs: readonly ReceiptLog[],
	expected: { label: string; registrar: string; renewerV1: string; referrer: string },
): Date {
	const renewers = [expected.registrar, expected.renewerV1]
		.filter((address): address is string => Boolean(address))
		.map((address) => getAddress(address));
	const events = logs.flatMap((log) => {
		if (!renewers.includes(getAddress(log.address))) return [];
		try {
			const event = decodeEventLog({
				abi: NAME_RENEWED,
				data: log.data,
				topics: log.topics as [Hex, ...Hex[]],
				strict: true,
			});
			return event.eventName === "NameRenewed" ? [event] : [];
		} catch {
			return [];
		}
	});
	if (events.length !== 1) {
		throw new Error("The receipt does not contain exactly one expected ENS renewal event.");
	}
	const args = events[0].args as {
		tokenId: bigint;
		label: string;
		newExpiry: bigint;
		paymentToken: Address;
		referrer: Hex;
	};
	if (
		args.label !== expected.label
		|| getAddress(args.paymentToken) !== getAddress(HUB_CHAIN.usdcAddress)
		|| args.referrer.toLowerCase() !== expected.referrer.toLowerCase()
	) {
		throw new Error("The ENS renewal event does not match the expected Namepass renewal.");
	}
	const milliseconds = args.newExpiry * 1_000n;
	if (milliseconds > 8_640_000_000_000_000n) throw new Error("The ENS expiry is outside the date range.");
	return new Date(Number(milliseconds));
}

const HELPER_USED = parseAbi(["event HelperUsed(address indexed helper, bytes32 indexed labelHash, address indexed wallet)"]);
const METADATA = parseAbi([
	"function ethRegistrar() view returns (address)",
	"function ethRenewerV1() view returns (address)",
	"function referrer() view returns (bytes32)",
]);

/** Bind expiry to the helper actually used, even if the pointer changed later in this block. */
export function receiptHelper(logs: readonly ReceiptLog[], label: string): Address {
	const matching = logs.flatMap((log) => {
		if (getAddress(log.address) !== getAddress(HUB_CHAIN.gatewayAddress!)) return [];
		try {
			const event = decodeEventLog({ abi: HELPER_USED, ...log, topics: log.topics as [Hex, ...Hex[]], strict: true });
			return event.args.labelHash === keccak256(stringToHex(label)) ? [event.args.helper] : [];
		} catch { return []; }
	});
	if (matching.length !== 1) throw new Error("The receipt has no unique gateway helper selection.");
	return matching[0];
}

export async function readReceiptEnsEvidence(logs: readonly (ReceiptLog & { logIndex?: number })[], label: string, blockNumber: bigint) {
	const helper = receiptHelper(logs, label);
	const rpcUrl = process.env[HUB_CHAIN.rpcEnv];
	if (!rpcUrl) throw new Error(`${HUB_CHAIN.rpcEnv} is not configured.`);
	const client = createPublicClient({ transport: http(rpcUrl, { timeout: 8000, retryCount: 0 }) });
	if (await client.getChainId() !== HUB_CHAIN.chainId) throw new Error("The receipt RPC serves the wrong chain.");
	const [registrar, renewerV1, referrer] = await Promise.all([
		client.readContract({ address: helper, abi: METADATA, functionName: "ethRegistrar", blockNumber }),
		client.readContract({ address: helper, abi: METADATA, functionName: "ethRenewerV1", blockNumber }),
		client.readContract({ address: helper, abi: METADATA, functionName: "referrer", blockNumber }),
	]);
	const expiry = parseEnsRenewalExpiry(logs, { label, registrar, renewerV1, referrer });
	const matching = logs.flatMap(log => {
		if (![getAddress(registrar), getAddress(renewerV1)].includes(getAddress(log.address))) return [];
		try {
			return [{ log, args: decodeEventLog({
				abi: NAME_RENEWED, ...log, topics: log.topics as [Hex, ...Hex[]], strict: true,
			}).args }];
		} catch { return []; }
	});
	const selected = matching[0]; // parseEnsRenewalExpiry requires exactly one.
	return {
		expiry, helper, address: selected.log.address, logIndex: selected.log.logIndex ?? null,
		tokenId: selected.args.tokenId.toString(), durationSeconds: selected.args.duration.toString(),
		amountApplied: selected.args.amount.toString(), paymentToken: selected.args.paymentToken, referrer,
	};
}

export async function readReceiptEnsExpiry(logs: readonly ReceiptLog[], label: string, blockNumber: bigint): Promise<Date> {
	return (await readReceiptEnsEvidence(logs, label, blockNumber)).expiry;
}
