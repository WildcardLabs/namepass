import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { chainById } from "../src/lib/chains";
import { depositAddress, normalizeLabel } from "../src/lib/namepass";
import type { components } from "../src/lib/integration-api.generated";

export type FundingAddress = components["schemas"]["AddressResponse"];
export type FundingQuote = components["schemas"]["QuoteResponse"];
export type FundingMode = "erc20" | "native";

export function usdcUnits(input: string): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(input) || parseUnits(input, 6) <= 0n)
    throw new Error(
      "Enter a positive USDC amount with at most six decimal places.",
    );
  return parseUnits(input, 6).toString();
}

/** The temporary canary page is restricted to the reviewed testnet deployment. */
export function fundingTransaction(
  address: FundingAddress,
  quote: FundingQuote,
  mode: FundingMode,
) {
  const chain = chainById(Number(quote.chainId));
  if (!chain || chain.environment !== "testnet" || chain.status !== "active")
    throw new Error("This canary accepts supported testnets only.");
  const name = `${normalizeLabel(address.name)}.eth`;
  if (
    quote.name !== name ||
    address.depositAddress.toLowerCase() !== depositAddress(name).toLowerCase()
  )
    throw new Error(
      "The API address does not match the current Namepass deployment.",
    );
  const funding = address.chains.find((c) => c.chainId === quote.chainId);
  if (
    !funding ||
    funding.tokenAddress.toLowerCase() !== chain.usdcAddress.toLowerCase()
  )
    throw new Error(
      "The API token or network does not match the reviewed testnet configuration.",
    );
  if (
    !/^\d+$/.test(quote.amount) ||
    BigInt(quote.amount) < BigInt(funding.minimumAmount) ||
    BigInt(quote.secondsAdded) <= 0n
  )
    throw new Error("The amount does not cover a renewal.");
  const chainId = `0x${chain.chainId.toString(16)}`;
  if (mode === "native") {
    if (chain.key !== "arc")
      throw new Error("Native USDC funding is available on Arc Testnet only.");
    return {
      chainId,
      to: address.depositAddress,
      value: `0x${(BigInt(quote.amount) * 10n ** 12n).toString(16)}`,
      data: "0x",
    };
  }
  return {
    chainId,
    to: funding.tokenAddress,
    value: "0x0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [address.depositAddress as `0x${string}`, BigInt(quote.amount)],
    }),
  };
}
