/**
 * Shared chain and deployment configuration.
 *
 * This file contains public identifiers only. Keep RPC URLs and signer keys in
 * environment variables. Frontend and server code must derive their views
 * from this registry instead of adding a new chain list.
 */

export type ChainKey = "ethereum" | "base" | "arbitrum" | "arc";
export type ChainEnvironment = "testnet" | "mainnet";
export type ChainStatus = "active" | "planned";

export interface ChainDefinition {
	key: ChainKey;
	name: string;
	network: string;
	chainId: number;
	environment: ChainEnvironment;
	status: ChainStatus;
	logo: string;
	tagColor: string;
	tagPingDelayMs: number;
	tokenOrder: number;
	fundingOrder: number;
	goldskyPrefix: string;
	usdcAddress: string;
	tokenNote?: string;
	/* Planned chains have Circle deployments but no Namepass deployment yet. */
	factoryAddress?: string;
	helperAddress?: string;
	ensRegistrarAddress?: string;
	ensRenewerV1Address?: string;
	ensReferrer?: string;
	tokenMessengerAddress?: string;
	messageTransmitterAddress: string;
	circleDomain: number;
	circleFinalityThreshold: number;
	explorerUrl: string;
	rpcEnv: string;
	depositFinality: { method: "rpc-tag"; tag: "finalized" };
	polling: {
		receiptMs: number;
		attestation: { initialMs: number; maxMs: number } | null;
	};
}

const FACTORY = "0xe0b155Fdb1104824d7E0568aeAFCC52823EDD00F";
const HELPER = "0xf1b51552098ffa7dc2cd83d0fb6508e57db8acc1";
const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const MAINNET_TOKEN_MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
const MAINNET_MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

/** Change this only with reviewed deployments and a mainnet canary. */
export const ACTIVE_ENVIRONMENT: ChainEnvironment = "testnet";

/**
 * This remains false until the Phase 8 gate is complete. A mainnet change must
 * update this value, the three deployment rows, and the canary evidence in one
 * reviewed change.
 */
export const MAINNET_LAUNCH_APPROVED = false;

export const CHAIN_REGISTRY: readonly ChainDefinition[] = [
	{
		key: "base",
		name: "Base",
		network: "Base Sepolia",
		chainId: 84532,
		environment: "testnet",
		status: "active",
		logo: "base.svg",
		tagColor: "#0052FF",
		tagPingDelayMs: 0,
		tokenOrder: 1,
		fundingOrder: 0,
		goldskyPrefix: "base_sepolia",
		usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
		factoryAddress: FACTORY,
		tokenMessengerAddress: TOKEN_MESSENGER,
		messageTransmitterAddress: MESSAGE_TRANSMITTER,
		circleDomain: 6,
		circleFinalityThreshold: 2000,
		explorerUrl: "https://sepolia.basescan.org",
		rpcEnv: "BASE_SEPOLIA_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: {
			receiptMs: 5_000,
			attestation: { initialMs: 30_000, maxMs: 120_000 },
		},
	},
	{
		key: "arbitrum",
		name: "Arbitrum",
		network: "Arbitrum Sepolia",
		chainId: 421614,
		environment: "testnet",
		status: "active",
		logo: "arbitrum.svg",
		tagColor: "#12AAFF",
		tagPingDelayMs: 300,
		tokenOrder: 2,
		fundingOrder: 1,
		goldskyPrefix: "arbitrum_sepolia",
		usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
		factoryAddress: FACTORY,
		tokenMessengerAddress: TOKEN_MESSENGER,
		messageTransmitterAddress: MESSAGE_TRANSMITTER,
		circleDomain: 3,
		circleFinalityThreshold: 2000,
		explorerUrl: "https://sepolia.arbiscan.io",
		rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: {
			receiptMs: 5_000,
			attestation: { initialMs: 30_000, maxMs: 120_000 },
		},
	},
	{
		key: "ethereum",
		name: "Ethereum",
		network: "Sepolia",
		chainId: 11155111,
		environment: "testnet",
		status: "active",
		logo: "ethereum.svg",
		tagColor: "#627EEA",
		tagPingDelayMs: 900,
		tokenOrder: 0,
		fundingOrder: 3,
		goldskyPrefix: "ethereum_sepolia",
		usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
		factoryAddress: FACTORY,
		helperAddress: HELPER,
		ensRegistrarAddress: "0xa88553F454b77203B0D036A05c894d555EAAa2Cc",
		ensRenewerV1Address: "0x4ad56feb5Fc7B8298db06E88fd5CBc41D64602Fa",
		ensReferrer: "0x0000000000000000000000001208a26faa0f4ac65b42098419eb4daa5e580ac6",
		tokenMessengerAddress: TOKEN_MESSENGER,
		messageTransmitterAddress: MESSAGE_TRANSMITTER,
		circleDomain: 0,
		circleFinalityThreshold: 0,
		explorerUrl: "https://sepolia.etherscan.io",
		rpcEnv: "ETHEREUM_SEPOLIA_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: { receiptMs: 5_000, attestation: null },
	},
	{
		key: "arc",
		name: "Arc",
		network: "Arc Testnet",
		chainId: 5042002,
		environment: "testnet",
		status: "active",
		logo: "arc.svg",
		tagColor: "#1B3158",
		tagPingDelayMs: 1200,
		tokenOrder: 3,
		fundingOrder: 2,
		goldskyPrefix: "arc_testnet",
		usdcAddress: "0x3600000000000000000000000000000000000000",
		tokenNote:
			"USDC is Arc's gas token, so it lives at a system address rather than a deployed contract.",
		factoryAddress: FACTORY,
		tokenMessengerAddress: TOKEN_MESSENGER,
		messageTransmitterAddress: MESSAGE_TRANSMITTER,
		circleDomain: 26,
		circleFinalityThreshold: 2000,
		explorerUrl: "https://testnet.arcscan.app",
		rpcEnv: "ARC_TESTNET_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: {
			receiptMs: 5_000,
			attestation: { initialMs: 5_000, maxMs: 30_000 },
		},
	},
	{
		key: "ethereum",
		name: "Ethereum",
		network: "Ethereum",
		chainId: 1,
		environment: "mainnet",
		status: "planned",
		logo: "ethereum.svg",
		tagColor: "#627EEA",
		tagPingDelayMs: 900,
		tokenOrder: 0,
		fundingOrder: 3,
		goldskyPrefix: "ethereum",
		usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		tokenMessengerAddress: MAINNET_TOKEN_MESSENGER,
		messageTransmitterAddress: MAINNET_MESSAGE_TRANSMITTER,
		circleDomain: 0,
		circleFinalityThreshold: 0,
		explorerUrl: "https://etherscan.io",
		rpcEnv: "ETHEREUM_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: { receiptMs: 5_000, attestation: null },
	},
	{
		key: "base",
		name: "Base",
		network: "Base",
		chainId: 8453,
		environment: "mainnet",
		status: "planned",
		logo: "base.svg",
		tagColor: "#0052FF",
		tagPingDelayMs: 0,
		tokenOrder: 1,
		fundingOrder: 0,
		goldskyPrefix: "base",
		usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		tokenMessengerAddress: MAINNET_TOKEN_MESSENGER,
		messageTransmitterAddress: MAINNET_MESSAGE_TRANSMITTER,
		circleDomain: 6,
		circleFinalityThreshold: 2000,
		explorerUrl: "https://basescan.org",
		rpcEnv: "BASE_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: {
			receiptMs: 5_000,
			attestation: { initialMs: 30_000, maxMs: 120_000 },
		},
	},
	{
		key: "arbitrum",
		name: "Arbitrum",
		network: "Arbitrum One",
		chainId: 42161,
		environment: "mainnet",
		status: "planned",
		logo: "arbitrum.svg",
		tagColor: "#12AAFF",
		tagPingDelayMs: 300,
		tokenOrder: 2,
		fundingOrder: 1,
		goldskyPrefix: "arbitrum",
		usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
		tokenMessengerAddress: MAINNET_TOKEN_MESSENGER,
		messageTransmitterAddress: MAINNET_MESSAGE_TRANSMITTER,
		circleDomain: 3,
		circleFinalityThreshold: 2000,
		explorerUrl: "https://arbiscan.io",
		rpcEnv: "ARBITRUM_RPC_URL",
		depositFinality: { method: "rpc-tag", tag: "finalized" },
		polling: {
			receiptMs: 5_000,
			attestation: { initialMs: 30_000, maxMs: 120_000 },
		},
	},
];

export const STABLE_TESTNET_CHAINS = CHAIN_REGISTRY.filter(
	(chain) => chain.environment === "testnet",
);

export const INITIAL_MAINNET_CHAINS = CHAIN_REGISTRY.filter(
	(chain) => chain.environment === "mainnet",
);

export const ACTIVE_CHAINS = CHAIN_REGISTRY.filter(
	(chain) => chain.environment === ACTIVE_ENVIRONMENT && chain.status === "active",
);

export const IS_TESTNET = ACTIVE_ENVIRONMENT === "testnet";

export const HUB_CHAIN = ACTIVE_CHAINS.find(
	(chain) => chain.key === "ethereum",
)!;

/** Public configuration returned to the browser. */
export const PUBLIC_CHAINS = ACTIVE_CHAINS.map((chain) => ({
	key: chain.key,
	name: chain.name,
	network: chain.network,
	chainId: chain.chainId,
	testnet: chain.environment === "testnet",
	logo: chain.logo,
	usdcAddress: chain.usdcAddress,
	tokenExplorerUrl: `${chain.explorerUrl}/token/${chain.usdcAddress}`,
	txExplorerUrl: `${chain.explorerUrl}/tx/`,
	tokenNote: chain.tokenNote,
}));

/** Private-process configuration. It contains identifiers, but no secrets. */
export const SERVER_CHAINS = ACTIVE_CHAINS.map((chain) => ({
	key: chain.key,
	name: chain.name,
	network: chain.network,
	chainId: chain.chainId,
	testnet: chain.environment === "testnet",
	goldskyPrefix: chain.goldskyPrefix,
	usdcAddress: chain.usdcAddress,
	factoryAddress: chain.factoryAddress,
	helperAddress: chain.helperAddress,
	ensRegistrarAddress: chain.ensRegistrarAddress,
	ensRenewerV1Address: chain.ensRenewerV1Address,
	tokenMessengerAddress: chain.tokenMessengerAddress,
	messageTransmitterAddress: chain.messageTransmitterAddress,
	circleDomain: chain.circleDomain,
	circleFinalityThreshold: chain.circleFinalityThreshold,
	rpcEnv: chain.rpcEnv,
	depositFinality: chain.depositFinality,
	polling: chain.polling,
}));

export const TOKEN_CHAINS = [...ACTIVE_CHAINS].sort(
	(a, b) => a.tokenOrder - b.tokenOrder,
);

export const FUNDING_CHAINS = [...ACTIVE_CHAINS].sort(
	(a, b) => a.fundingOrder - b.fundingOrder,
);

export function chainById(chainId: number): ChainDefinition | undefined {
	return ACTIVE_CHAINS.find((chain) => chain.chainId === chainId);
}

export function chainByKey(key: ChainKey): ChainDefinition {
	const chain = ACTIVE_CHAINS.find((entry) => entry.key === key);
	if (!chain) throw new Error(`Chain registry has no ${key} entry.`);
	return chain;
}

export function chainByName(name: string): ChainDefinition | undefined {
	return ACTIVE_CHAINS.find((chain) => chain.name === name);
}

/** Fail at startup when a hand-edited registry is incomplete or ambiguous. */
export function assertChainRegistry(): void {
	if (ACTIVE_ENVIRONMENT === "mainnet" && !MAINNET_LAUNCH_APPROVED) {
		throw new Error("Mainnet requires the completed Phase 8 launch gate.");
	}

	if (ACTIVE_CHAINS.length === 0) {
		throw new Error(`The ${ACTIVE_ENVIRONMENT} registry has no active chains.`);
	}

	const required: Array<keyof ChainDefinition> = [
		"key",
		"name",
		"network",
		"chainId",
		"environment",
		"status",
		"logo",
		"tagColor",
		"tagPingDelayMs",
		"tokenOrder",
		"fundingOrder",
		"goldskyPrefix",
		"usdcAddress",
		"messageTransmitterAddress",
		"circleDomain",
		"circleFinalityThreshold",
		"explorerUrl",
		"rpcEnv",
		"depositFinality",
		"polling",
	];
	for (const chain of CHAIN_REGISTRY) {
		for (const field of required) {
			if (chain[field] === undefined || chain[field] === "") {
				throw new Error(`${chain.key} is missing ${field}.`);
			}
		}
		if (!chain.tokenMessengerAddress) {
			throw new Error(`${chain.key} is missing tokenMessengerAddress.`);
		}
		if (chain.status === "active" && !chain.factoryAddress) {
			throw new Error(`${chain.key} is missing factoryAddress.`);
		}
	}

	for (const field of ["chainId", "goldskyPrefix", "rpcEnv"] as const) {
		const values = CHAIN_REGISTRY.map((chain) => chain[field]);
		if (new Set(values).size !== values.length) {
			throw new Error(`Chain registry has duplicate ${field} values.`);
		}
	}

	if (ACTIVE_ENVIRONMENT === "mainnet") {
		if (INITIAL_MAINNET_CHAINS.some((chain) => chain.status !== "active")) {
			throw new Error("Every initial mainnet chain must be active at launch.");
		}
	}

	if (!HUB_CHAIN.factoryAddress || !HUB_CHAIN.helperAddress || !HUB_CHAIN.ensRegistrarAddress || !HUB_CHAIN.ensRenewerV1Address || !HUB_CHAIN.ensReferrer) {
		throw new Error("The hub chain is missing its helper or ENS deployment.");
	}
}

assertChainRegistry();
