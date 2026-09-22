import { createPublicClient, http, formatUnits } from "viem";
import { SERVER_CHAINS } from "../src/lib/chains";
import type { GasRead } from "../src/lib/monitoring";
import { configuredRelayerAddress } from "./config";
let cached: GasRead | undefined;
let pending: Promise<GasRead> | undefined;
/** Explicit dashboard requests only. One balance read per chain, with bounded retries and cache. */
export async function monitoringGas(): Promise<GasRead> {
  if (cached && Date.now() - Date.parse(cached.checkedAt) < 60_000)
    return cached;
  if (pending) return pending;
  pending = (async () => {
    const address = configuredRelayerAddress();
    const chains = await Promise.all(
      SERVER_CHAINS.map(async (chain) => {
        const base = {
          chainId: chain.chainId,
          symbol: chain.key === "arc" ? "USDC" : "ETH",
        };
        const url = process.env[chain.rpcEnv];
        if (!address || !url)
          return { ...base, balance: null, error: "Not configured" };
        try {
          const balance = await createPublicClient({
            transport: http(url, { timeout: 8_000, retryCount: 0 }),
          }).getBalance({ address: address as `0x${string}` });
          return { ...base, balance: formatUnits(balance, 18), error: null };
        } catch {
          return { ...base, balance: null, error: "Balance read failed" };
        }
      }),
    );
    cached = { address, checkedAt: new Date().toISOString(), chains };
    return cached;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
