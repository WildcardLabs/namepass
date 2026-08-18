/** Public native USDC view, derived from the shared chain registry. */
import { TOKEN_CHAINS } from "./chains";

export { IS_TESTNET } from "./chains";

export interface SupportedToken {
	chain: string;
	network: string;
	logo: string;
	address: string;
	explorer: string;
	note?: string;
}

export const SUPPORTED_TOKENS: SupportedToken[] = TOKEN_CHAINS.map((chain) => ({
	chain: chain.name,
	network: chain.network,
	logo: chain.logo,
	address: chain.usdcAddress,
	explorer: `${chain.explorerUrl}/token/${chain.usdcAddress}`,
	note: chain.tokenNote,
}));
