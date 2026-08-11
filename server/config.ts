import type { ChainKey } from "../src/lib/chains";
import { SERVER_CHAINS } from "../src/lib/chains";
import { checksumAddress } from "../src/lib/namepass";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const MINIMUM_TRIGGER_BY_CHAIN: Record<ChainKey, bigint> = {
	ethereum: 500_000n,
	base: 500_000n,
	arbitrum: 500_000n,
	arc: 500_000n,
};

export const CHAIN_TRIGGER_CONFIG = SERVER_CHAINS.map((chain) => ({
	chainId: chain.chainId,
	minimumTriggerAmount: MINIMUM_TRIGGER_BY_CHAIN[chain.key],
}));

export function minimumTriggerAmount(chainId: number): bigint {
	const config = CHAIN_TRIGGER_CONFIG.find((entry) => entry.chainId === chainId);
	if (!config) throw new Error(`Chain ${chainId} has no trigger configuration.`);
	return config.minimumTriggerAmount;
}

/** Public address only. Derive it from the key when the key exists. */
export function configuredRelayerAddress(): string | null {
	const configured = process.env.RELAYER_ADDRESS;
	if (configured && !/^0x[0-9a-f]{40}$/i.test(configured)) {
		throw new Error("RELAYER_ADDRESS is not a valid address.");
	}
	const configuredAddress = configured ? checksumAddress(configured) : null;
	const key = process.env.RELAYER_PRIVATE_KEY;
	if (!key) return configuredAddress;
	if (!/^0x[0-9a-f]{64}$/i.test(key)) {
		throw new Error("RELAYER_PRIVATE_KEY is not configured correctly.");
	}
	const derivedAddress = privateKeyToAccount(key as Hex).address;
	if (configuredAddress && configuredAddress !== derivedAddress) {
		throw new Error("RELAYER_ADDRESS does not match RELAYER_PRIVATE_KEY.");
	}
	return derivedAddress;
}
