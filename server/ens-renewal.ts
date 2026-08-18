import { decodeEventLog, getAddress, parseAbi, type Address, type Hex } from "viem";

import { HUB_CHAIN } from "../src/lib/chains";

const NAME_RENEWED = parseAbi([
	"event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);

type ReceiptLog = { address: Address; data: Hex; topics: readonly Hex[] };

/** Read the authoritative ENS expiry from the same receipt as a Namepass renewal. */
export function parseEnsRenewalExpiry(
	logs: readonly ReceiptLog[],
	expected: { label: string; labelHash: Hex },
): Date {
	const renewers = [HUB_CHAIN.ensRegistrarAddress, HUB_CHAIN.ensRenewerV1Address]
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
		args.tokenId !== BigInt(expected.labelHash)
		|| args.label !== expected.label
		|| getAddress(args.paymentToken) !== getAddress(HUB_CHAIN.usdcAddress)
		|| args.referrer.toLowerCase() !== HUB_CHAIN.ensReferrer?.toLowerCase()
	) {
		throw new Error("The ENS renewal event does not match the expected Namepass renewal.");
	}
	const milliseconds = args.newExpiry * 1_000n;
	if (milliseconds > 8_640_000_000_000_000n) throw new Error("The ENS expiry is outside the date range.");
	return new Date(Number(milliseconds));
}
