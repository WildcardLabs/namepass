// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
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
  estimate: true,
};

describe("testnet canary payment boundary", () => {
  it("preserves exact six-decimal USDC without silently rounding", () => {
    expect(usdcUnits("1.000001")).toBe("1000001");
    for (const amount of ["0", "-1", "1.0000001", "1e6", "NaN"])
      expect(() => usdcUnits(amount)).toThrow();
  });
  it("encodes only the USDC transfer to the returned, independently verified deposit address", () => {
    const tx = fundingTransaction(address, quote, "erc20");
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
      ),
    ).toEqual({
      chainId: "0x4cef52",
      to: address.depositAddress,
      value: "0xde0b6b3a7640000",
      data: "0x",
    });
    expect(() => fundingTransaction(address, quote, "native")).toThrow(
      /Arc/,
    );
  });
  it("rejects mainnet, modified payment destinations and token mismatches", () => {
    expect(() =>
      fundingTransaction(address, { ...quote, chainId: "1" }, "erc20"),
    ).toThrow(/testnet/);
    expect(() =>
      fundingTransaction(
        {
          ...address,
          depositAddress: "0x0000000000000000000000000000000000000001",
        },
        quote,
        "erc20",
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
      ),
    ).toThrow(/token/);
  });
});

it("opens the wallet after a prepared estimate ages without another API request", async () => {
  const html = await readFile("tools/integration-canary.html", "utf8");
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
  localStorage.clear();
  let clock = now;
  const date = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const methods: string[] = [];
  let quoteRequests = 0;
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      methods.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return ["0x0000000000000000000000000000000000000001"];
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "eth_sendTransaction")
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      throw new Error(`Unexpected wallet request: ${method}`);
    }),
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/address")) return Response.json(address);
    if (!body.name) return Response.json({ error: { message: "name required" } }, { status: 400 });
    quoteRequests++;
    return Response.json(quote);
  }));
  try {
    await import("./integration-canary");
    const click = async (id: string) => {
      const button = document.getElementById(id) as HTMLButtonElement;
      await button.onclick!(new MouseEvent("click") as PointerEvent);
    };
    await click("prepare");
    await click("connect");
    expect(quoteRequests).toBe(1);
    clock += 61000;
    await click("send");
    expect(quoteRequests).toBe(1);
    expect(methods).toContain("eth_sendTransaction");
    expect(document.getElementById("wallet-notice")!.textContent).toBe("User rejected the request.");
    expect(JSON.parse(localStorage.getItem("namepass-public-integration-canaries-v1")!)[0].phase).toBe("rejected");
  } finally {
    date.mockRestore();
    vi.unstubAllGlobals();
    delete (window as Window & { ethereum?: unknown }).ethereum;
    localStorage.clear();
  }
});
