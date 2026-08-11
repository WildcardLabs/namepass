import { existsSync } from "node:fs";
import {
	CHAIN_REGISTRY,
	ACTIVE_CHAINS,
	ACTIVE_ENVIRONMENT,
	INITIAL_MAINNET_CHAINS,
	MAINNET_LAUNCH_APPROVED,
	PUBLIC_CHAINS,
	SERVER_CHAINS,
	STABLE_TESTNET_CHAINS,
} from "../src/lib/chains.ts";

if (ACTIVE_ENVIRONMENT !== "testnet" || MAINNET_LAUNCH_APPROVED) {
	throw new Error("This branch must remain testnet-only until the Phase 8 launch gate.");
}

if (
	PUBLIC_CHAINS.length !== ACTIVE_CHAINS.length ||
	SERVER_CHAINS.length !== ACTIVE_CHAINS.length
) {
	throw new Error("A generated chain view is incomplete.");
}

if (
	STABLE_TESTNET_CHAINS.map((chain) => chain.key).join(",") !==
		"base,arbitrum,ethereum,arc" ||
	INITIAL_MAINNET_CHAINS.map((chain) => chain.key).join(",") !==
		"ethereum,base,arbitrum" ||
	!STABLE_TESTNET_CHAINS.every((chain) => chain.status === "active") ||
	!INITIAL_MAINNET_CHAINS.every((chain) => chain.status === "planned")
) {
	throw new Error("The launch chain sets are incomplete.");
}

const mainnetCircle = {
	ethereum: {
		chainId: 1,
		usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		circleDomain: 0,
		tokenMessengerAddress: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
		messageTransmitterAddress: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
	},
	base: {
		chainId: 8453,
		usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		circleDomain: 6,
		tokenMessengerAddress: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
		messageTransmitterAddress: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
	},
	arbitrum: {
		chainId: 42161,
		usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
		circleDomain: 3,
		tokenMessengerAddress: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
		messageTransmitterAddress: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
	},
};

for (const chain of INITIAL_MAINNET_CHAINS) {
	const expected = mainnetCircle[chain.key];
	if (
		!expected ||
		chain.chainId !== expected.chainId ||
		chain.usdcAddress !== expected.usdcAddress ||
		chain.circleDomain !== expected.circleDomain ||
		chain.tokenMessengerAddress !== expected.tokenMessengerAddress ||
		chain.messageTransmitterAddress !== expected.messageTransmitterAddress ||
		chain.factoryAddress ||
		chain.helperAddress ||
		chain.ensRegistrarAddress ||
		chain.ensRenewerV1Address
	) {
		throw new Error(`${chain.key} is not a clean planned mainnet entry.`);
	}
}

for (const chain of CHAIN_REGISTRY) {
	const logo = new URL(`../public/logos/${chain.logo}`, import.meta.url);
	if (!existsSync(logo)) throw new Error(`${chain.key} is missing ${chain.logo}.`);
	if (!chain.tokenMessengerAddress) {
		throw new Error(`${chain.key} is missing the destination TokenMessenger.`);
	}
}

console.log(`Checked ${CHAIN_REGISTRY.length} complete chain entries.`);
