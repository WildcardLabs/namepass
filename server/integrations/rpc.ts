import { createPublicClient, http } from "viem";
import type { ChainDefinition } from "../../src/lib/chains";

/** Evidence work has a finite request budget; failed reads retain unknown state. */
export async function evidenceClient(chain: ChainDefinition) {
	const url = process.env[chain.rpcEnv];
	if (!url) throw new Error("evidence_rpc_unconfigured");
	const client = createPublicClient({
		transport: http(url, { timeout: 8000, retryCount: 0 }),
	});
	if ((await client.getChainId()) !== chain.chainId)
		throw new Error("evidence_rpc_chain_mismatch");
	return client;
}
