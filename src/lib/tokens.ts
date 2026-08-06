/**
 * The one token Namepass accepts, and where it lives on each supported chain.
 *
 * Unlike `registry.ts`, **nothing here is simulated** — these are real contract
 * addresses, published to users as the thing to check before sending money.
 * Treat a change here the way you'd treat a change to a payment address: verify
 * against Circle's own list, don't paste from a block explorer search result,
 * and don't reformat the casing (EIP-55 checksum casing is what a wallet
 * compares against).
 *
 * **These are TESTNET addresses.** The app is a testnet deployment, so sending
 * mainnet USDC to anything derived here is a mistake nobody can undo. If this
 * ever goes to mainnet, this file and `IS_TESTNET` change together — a mismatch
 * between the banner and this list is the worst possible bug in this file.
 *
 * Verified 2026-08-05 against
 * https://developers.circle.com/stablecoins/usdc-contract-addresses
 */

/** Drives the testnet banner and the copy on the supported-tokens page. */
export const IS_TESTNET = true;

export interface SupportedToken {
	/** Chain name — must match the `ChainTag` / `registry.ts` chain pool. */
	chain: string;
	/** The specific network these addresses are on. */
	network: string;
	/** Logo in `public/logos/`. */
	logo: string;
	/** EIP-55 checksummed USDC contract on that network. */
	address: string;
	/** Block explorer token page, for verification away from this site. */
	explorer: string;
	/** Shown where the chain behaves differently enough to matter. */
	note?: string;
}

/**
 * Testnet USDC. Bridged representations (`USDC.e` and friends) are different
 * contracts and are deliberately absent; see `SupportedTokens.tsx` for why this
 * list is a whitelist rather than a list of things to avoid.
 */
export const SUPPORTED_TOKENS: SupportedToken[] = [
	{
		chain: "Ethereum",
		network: "Sepolia",
		logo: "ethereum.svg",
		address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
		explorer:
			"https://sepolia.etherscan.io/token/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
	},
	{
		chain: "Base",
		network: "Base Sepolia",
		logo: "base.svg",
		address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
		explorer:
			"https://sepolia.basescan.org/token/0x036CbD53842c5426634e7929541eC2318f3dCF7e",
	},
	{
		chain: "Arbitrum",
		network: "Arbitrum Sepolia",
		logo: "arbitrum.svg",
		address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
		explorer:
			"https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
	},
	{
		chain: "Arc",
		network: "Arc Testnet",
		logo: "arc.svg",
		address: "0x3600000000000000000000000000000000000000",
		explorer:
			"https://testnet.arcscan.app/token/0x3600000000000000000000000000000000000000",
		/* Arc pays gas in USDC, so the token sits at a system predeploy rather
		   than a deployed ERC-20 — hence an address that looks unlike the
		   others. It is not a typo, and it's worth saying so on a page whose
		   whole job is "check this matches". */
		note: "USDC is Arc's gas token, so it lives at a system address rather than a deployed contract.",
	},
];

/** USDC is a 6-decimal token everywhere Namepass supports it. */
export const USDC_DECIMALS = 6;
