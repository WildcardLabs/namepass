import type { Address } from "viem";

/** Sourcify returns 404 with an identified, unmatched contract before publication. */
export async function readSourceStatus(chainId: number, address: Address, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`/sourcify/v2/contract/${chainId}/${address}`);
  if (!response.ok && response.status !== 404) throw new Error(`Source verification service returned HTTP ${response.status}. Try again shortly.`);
  let result: { chainId?: string; address?: string; creationMatch?: unknown; runtimeMatch?: unknown };
  try { result = await response.json(); }
  catch { throw new Error("Source verification service returned an invalid response."); }
  if (!result || String(result.chainId) !== String(chainId) || typeof result.address !== "string" || result.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Source verification response does not identify the requested contract.");
  }
  if (response.status === 404) {
    if (result.creationMatch === null && result.runtimeMatch === null) return false;
    throw new Error("Source verification service returned an unexpected 404 response.");
  }
  const matched = (value: unknown) => value === "match" || value === "exact_match";
  return matched(result.creationMatch) && matched(result.runtimeMatch);
}
