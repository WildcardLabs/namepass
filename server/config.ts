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

function commaSeparated(value: string | undefined): string[] {
	return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

/** Return one legacy key or the four-key Ethereum relayer pool. */
export function configuredRelayerPrivateKeys(): readonly Hex[] {
	const pool = commaSeparated(process.env.RELAYER_PRIVATE_KEYS);
	const values = pool.length ? pool : commaSeparated(process.env.RELAYER_PRIVATE_KEY);
	if (pool.length && pool.length !== 4) {
		throw new Error("RELAYER_PRIVATE_KEYS must contain exactly four keys.");
	}
	if (values.some((key) => !/^0x[0-9a-f]{64}$/i.test(key))) {
		throw new Error("A relayer private key is not configured correctly.");
	}
	if (new Set(values.map((key) => key.toLowerCase())).size !== values.length) {
		throw new Error("Relayer private keys must be unique.");
	}
	return values as Hex[];
}

/** Public addresses only. Derive them from keys when keys exist. */
export function configuredRelayerAddresses(): readonly string[] {
	const pool = commaSeparated(process.env.RELAYER_ADDRESSES);
	const legacy = commaSeparated(process.env.RELAYER_ADDRESS);
	if (pool.length && pool.length !== 4) {
		throw new Error("RELAYER_ADDRESSES must contain exactly four addresses.");
	}
	const configured = pool.length
		? pool
		: commaSeparated(process.env.RELAYER_PRIVATE_KEYS).length
			? []
			: legacy;
	if (configured.some((address) => !/^0x[0-9a-f]{40}$/i.test(address))) {
		throw new Error("A relayer address is not valid.");
	}
	const configuredAddresses = configured.map(checksumAddress);
	const keys = configuredRelayerPrivateKeys();
	const derivedAddresses = keys.map((key) => privateKeyToAccount(key).address);
	if (derivedAddresses.length && configuredAddresses.length) {
		if (derivedAddresses.length !== configuredAddresses.length
			|| derivedAddresses.some((address, index) => address !== configuredAddresses[index])) {
			throw new Error(derivedAddresses.length === 1
				? "RELAYER_ADDRESS does not match RELAYER_PRIVATE_KEY."
				: "RELAYER_ADDRESSES do not match RELAYER_PRIVATE_KEYS.");
		}
	}
	const addresses = derivedAddresses.length ? derivedAddresses : configuredAddresses;
	if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
		throw new Error("Relayer addresses must be unique.");
	}
	return addresses;
}

/** Compatibility field for clients that know only the primary relayer. */
export function configuredRelayerAddress(): string | null {
	return configuredRelayerAddresses()[0] ?? null;
}
