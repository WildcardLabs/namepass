import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { CHAIN_TRIGGER_CONFIG, configuredRelayerAddress, configuredRelayerAddresses, minimumTriggerAmount } from "./config";
import { SERVER_CHAINS } from "../src/lib/chains";
import { publicConfig } from "./reads";
import { minTrigger, setPublicConfig } from "../src/lib/triggerConfig";

test("every active chain has a public $0.50 trigger minimum", () => {
	assert.deepEqual(
		CHAIN_TRIGGER_CONFIG.map((entry) => entry.chainId).sort((a, b) => a - b),
		SERVER_CHAINS.map((chain) => chain.chainId).sort((a, b) => a - b),
	);
	for (const chain of SERVER_CHAINS) {
		assert.equal(minimumTriggerAmount(chain.chainId), 500_000n);
	}
	assert.deepEqual(
		publicConfig().chains.map((chain) => [chain.chainId, chain.minimumTriggerAmount]),
		SERVER_CHAINS.map((chain) => [chain.chainId, 500_000n]),
	);
});

test("the browser accepts only the complete public trigger configuration", () => {
	const config = publicConfig();
	const browserConfig = {
		chains: config.chains.map((chain) => ({
			chainId: chain.chainId,
			minimumTriggerAmount: chain.minimumTriggerAmount.toString(),
		})),
	};
	setPublicConfig(browserConfig);
	for (const chain of SERVER_CHAINS) {
		assert.equal(minTrigger(String(chain.chainId)), minimumTriggerAmount(chain.chainId));
	}
	assert.throws(
		() => setPublicConfig({ chains: browserConfig.chains.slice(1) }),
		/complete/,
	);
});

test("public configuration exposes only the configured relayer address", () => {
	const previousAddress = process.env.RELAYER_ADDRESS;
	const previousKey = process.env.RELAYER_PRIVATE_KEY;
	const previousAddresses = process.env.RELAYER_ADDRESSES;
	const previousKeys = process.env.RELAYER_PRIVATE_KEYS;
	try {
		delete process.env.RELAYER_ADDRESSES;
		delete process.env.RELAYER_PRIVATE_KEYS;
		delete process.env.RELAYER_PRIVATE_KEY;
		process.env.RELAYER_ADDRESS = "0x0000000000000000000000000000000000000001";
		const config = publicConfig();
		assert.equal(config.relayerAddress, "0x0000000000000000000000000000000000000001");
		assert.equal("relayerPrivateKey" in config, false);
	} finally {
		if (previousAddress === undefined) delete process.env.RELAYER_ADDRESS;
		else process.env.RELAYER_ADDRESS = previousAddress;
		if (previousKey === undefined) delete process.env.RELAYER_PRIVATE_KEY;
		else process.env.RELAYER_PRIVATE_KEY = previousKey;
		if (previousAddresses === undefined) delete process.env.RELAYER_ADDRESSES;
		else process.env.RELAYER_ADDRESSES = previousAddresses;
		if (previousKeys === undefined) delete process.env.RELAYER_PRIVATE_KEYS;
		else process.env.RELAYER_PRIVATE_KEYS = previousKeys;
	}
});

test("the configured relayer address derives from and must match the private key", () => {
	const previousAddress = process.env.RELAYER_ADDRESS;
	const previousKey = process.env.RELAYER_PRIVATE_KEY;
	const previousAddresses = process.env.RELAYER_ADDRESSES;
	const previousKeys = process.env.RELAYER_PRIVATE_KEYS;
	const key = `0x${"0".repeat(63)}1`;
	const derived = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
	try {
		delete process.env.RELAYER_ADDRESSES;
		delete process.env.RELAYER_PRIVATE_KEYS;
		process.env.RELAYER_PRIVATE_KEY = key;
		delete process.env.RELAYER_ADDRESS;
		assert.equal(configuredRelayerAddress(), derived);

		process.env.RELAYER_ADDRESS = derived.toLowerCase();
		assert.equal(configuredRelayerAddress(), derived);

		process.env.RELAYER_ADDRESS = "0x0000000000000000000000000000000000000001";
		assert.throws(configuredRelayerAddress, /does not match/);
	} finally {
		if (previousAddress === undefined) delete process.env.RELAYER_ADDRESS;
		else process.env.RELAYER_ADDRESS = previousAddress;
		if (previousKey === undefined) delete process.env.RELAYER_PRIVATE_KEY;
		else process.env.RELAYER_PRIVATE_KEY = previousKey;
		if (previousAddresses === undefined) delete process.env.RELAYER_ADDRESSES;
		else process.env.RELAYER_ADDRESSES = previousAddresses;
		if (previousKeys === undefined) delete process.env.RELAYER_PRIVATE_KEYS;
		else process.env.RELAYER_PRIVATE_KEYS = previousKeys;
	}
});

test("the Ethereum pool accepts exactly four ordered relayer keys", () => {
	const names = ["RELAYER_ADDRESS", "RELAYER_PRIVATE_KEY", "RELAYER_ADDRESSES", "RELAYER_PRIVATE_KEYS"] as const;
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	const keys = [1, 2, 3, 4].map((value) => `0x${value.toString(16).padStart(64, "0")}` as Hex);
	const addresses = keys.map((key) => privateKeyToAccount(key).address);
	try {
		delete process.env.RELAYER_ADDRESS;
		delete process.env.RELAYER_PRIVATE_KEY;
		process.env.RELAYER_PRIVATE_KEYS = keys.join(",");
		process.env.RELAYER_ADDRESSES = addresses.join(",");
		assert.deepEqual(configuredRelayerAddresses(), addresses);
		assert.equal(configuredRelayerAddress(), addresses[0]);
		assert.deepEqual(publicConfig().relayerAddresses, addresses);

		process.env.RELAYER_PRIVATE_KEYS = keys.slice(0, 3).join(",");
		assert.throws(configuredRelayerAddresses, /exactly four keys/);
	} finally {
		for (const name of names) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
	}
});
