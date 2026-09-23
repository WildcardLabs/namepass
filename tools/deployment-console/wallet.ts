import { createWalletClient, custom, getAddress, toHex, type Address, type EIP1193Provider, type Hex } from "viem";
import { network, type Plan, type Step } from "./model";

export type WalletProvider = EIP1193Provider & { isRainbow?: boolean; providers?: WalletProvider[]; on?: (event: string, fn: (...args: unknown[]) => void) => void; removeListener?: (event: string, fn: (...args: unknown[]) => void) => void };
export type WalletChoice = { info: { uuid: string; name: string; rdns: string }; provider: WalletProvider };
declare global { interface Window { ethereum?: WalletProvider } }
export function discover(onWallet: (wallet: WalletChoice) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WalletChoice>).detail;
    if (typeof detail?.provider?.request === "function" && typeof detail.info?.uuid === "string" && typeof detail.info?.name === "string") onWallet(detail);
  };
  window.addEventListener("eip6963:announceProvider", listener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const timer = setTimeout(() => {
    const injected = window.ethereum;
    if (!injected) return;
    for (const [i, provider] of (injected.providers ?? [injected]).entries()) {
      onWallet({ info: { uuid: `legacy-${i}`, name: provider.isRainbow ? "Rainbow" : "Browser wallet", rdns: "legacy" }, provider });
    }
  }, 500);
  return () => { clearTimeout(timer); window.removeEventListener("eip6963:announceProvider", listener); };
}
export async function walletAccount(provider: WalletProvider, request = false): Promise<Address | undefined> {
  const accounts = await provider.request({ method: request ? "eth_requestAccounts" : "eth_accounts" });
  return accounts[0] ? getAddress(accounts[0]) : undefined;
}
export async function switchNetwork(provider: WalletProvider, chainId: number) {
  const n = network(chainId);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(chainId) }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: toHex(chainId), chainName: n.network, nativeCurrency: n.chain.nativeCurrency, rpcUrls: [...n.chain.rpcUrls.default.http], blockExplorerUrls: [n.explorerUrl] }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(chainId) }] });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== chainId) throw new Error("The wallet did not switch to the required network.");
}
export async function sendStep(provider: WalletProvider, plan: Plan, step: Step): Promise<Hex> {
  const account = await walletAccount(provider);
  if (account !== plan.config.owner) throw new Error("Select the deployment wallet before signing.");
  if (Number(await provider.request({ method: "eth_chainId" })) !== step.chainId) throw new Error("Wallet network changed. Review the step again.");
  const wallet = createWalletClient({ account, chain: network(step.chainId).chain, transport: custom(provider) });
  return wallet.sendTransaction({ account, chain: network(step.chainId).chain, to: step.to, data: step.data, value: 0n });
}
