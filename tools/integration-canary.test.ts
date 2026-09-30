import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import {
  fundingTransaction,
  usdcUnits,
  type FundingAddress,
  type FundingQuote,
} from "./integration-canary-core";

const now = Date.parse("2026-09-30T12:00:00Z");
const address: FundingAddress = {
  name: "steve.eth",
  depositAddress: "0x5B7516768eD0b04E212041265BB1f11af71841d7",
  subname: "steve.namepass.eth",
  subnameVerified: false,
  chains: [
    {
      chainId: "11155111",
      name: "Sepolia",
      tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      minimumAmount: "200000",
    },
    {
      chainId: "5042002",
      name: "Arc Testnet",
      tokenAddress: "0x3600000000000000000000000000000000000000",
      minimumAmount: "200000",
    },
  ],
};
const quote: FundingQuote = {
  name: "steve.eth",
  chainId: "11155111",
  amount: "1000000",
  secondsAdded: "3547790",
  amountApplied: "900000",
  renewalFee: "100000",
  bridgeFee: "0",
  roundingRemainder: "0",
  pricingBlock: "11800000",
  expiresAt: "2026-09-30T12:01:00Z",
  estimate: true,
};

describe("testnet canary payment boundary", () => {
  it("preserves exact six-decimal USDC without silently rounding", () => {
    expect(usdcUnits("1.000001")).toBe("1000001");
    for (const amount of ["0", "-1", "1.0000001", "1e6", "NaN"])
      expect(() => usdcUnits(amount)).toThrow();
  });
  it("encodes only the USDC transfer to the returned, independently verified deposit address", () => {
    const tx = fundingTransaction(address, quote, "erc20", now);
    expect(tx.chainId).toBe("0xaa36a7");
    expect(tx.to).toBe("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
    expect(tx.value).toBe("0x0");
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: tx.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([
      "0x5B7516768eD0b04E212041265BB1f11af71841d7",
      1000000n,
    ]);
  });
  it("uses eighteen-decimal native USDC only on Arc", () => {
    expect(
      fundingTransaction(
        address,
        { ...quote, chainId: "5042002" },
        "native",
        now,
      ),
    ).toEqual({
      chainId: "0x4cef52",
      to: address.depositAddress,
      value: "0xde0b6b3a7640000",
      data: "0x",
    });
    expect(() => fundingTransaction(address, quote, "native", now)).toThrow(
      /Arc/,
    );
  });
  it("rejects mainnet, stale quotes, modified payment destinations and token mismatches", () => {
    expect(() =>
      fundingTransaction(address, { ...quote, chainId: "1" }, "erc20", now),
    ).toThrow(/testnet/);
    expect(() =>
      fundingTransaction(address, quote, "erc20", now + 60000),
    ).toThrow(/expired/);
    expect(() =>
      fundingTransaction(
        {
          ...address,
          depositAddress: "0x0000000000000000000000000000000000000001",
        },
        quote,
        "erc20",
        now,
      ),
    ).toThrow(/address/);
    expect(() =>
      fundingTransaction(
        {
          ...address,
          chains: [
            {
              ...address.chains[0],
              tokenAddress: "0x0000000000000000000000000000000000000001",
            },
          ],
        },
        quote,
        "erc20",
        now,
      ),
    ).toThrow(/token/);
  });
});
