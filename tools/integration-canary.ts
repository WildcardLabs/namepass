import { ACTIVE_CHAINS, chainById } from "../src/lib/chains";
import { normalizeLabel } from "../src/lib/namepass";
import {
  fundingTransaction,
  usdcUnits,
  type FundingAddress,
  type FundingQuote,
  type FundingMode,
} from "./integration-canary-core";
import type { components } from "../src/lib/integration-api.generated";

type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
type Wallet = {
  info: { uuid: string; name: string; rdns?: string };
  provider: Provider;
};
type Entry = {
  id: string;
  base: string;
  name: string;
  chainId: string;
  amount: string;
  mode: FundingMode;
  hash?: string;
  phase: string;
  address?: FundingAddress;
  quote?: FundingQuote;
  updates: unknown[];
  history?: unknown;
};
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const wallets = new Map<string, Wallet>();
const polling = new Map<string, AbortController>();
const storage = "namepass-public-integration-canaries-v1";
let entries: Entry[] = [];
try {
  const saved = JSON.parse(localStorage.getItem(storage) ?? "[]");
  if (Array.isArray(saved)) entries = saved;
} catch {
  /* Start without corrupted local evidence. */
}
let preparation:
  | {
      base: string;
      name: string;
      chainId: string;
      amount: string;
      address: FundingAddress;
      quote: FundingQuote;
    }
  | undefined;
let connected: { provider: Provider; account: string } | undefined;
let busy = false;
function notice(message: string, error = false) {
  $("notice").textContent = message;
  $("notice").dataset.error = String(error);
}
function save() {
  localStorage.setItem(storage, JSON.stringify(entries));
  renderEntries();
}
function baseUrl() {
  const url = new URL(input("origin").value.trim());
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use an HTTPS API origin, or a local development origin.");
  return url.origin;
}
class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly delay: number,
  ) {
    super(
      `HTTP ${status}: ${(body as { error?: { message?: string } })?.error?.message ?? "Request failed"}`,
    );
  }
}
async function api<T>(
  base: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok) {
    const after = Number(response.headers.get("Retry-After"));
    throw new RequestError(
      response.status,
      data,
      Number.isFinite(after) && after > 0 ? Math.min(60, after) * 1000 : 5000,
    );
  }
  return data as T;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}
function updateButtons() {
  button("prepare").disabled = busy;
  button("connect").disabled = busy || !wallets.size;
  button("send").disabled =
    busy ||
    !connected ||
    !preparation ||
    entries.some(
      (e) =>
        e.phase === "awaiting_wallet" || e.phase === "wallet_result_unknown",
    );
}
for (const chain of ACTIVE_CHAINS) {
  const option = new Option(chain.network, String(chain.chainId));
  select("chain").add(option);
}
select("chain").value = "11155111";
function fundingMode(): FundingMode {
  return select("chain").value === "5042002"
    ? (select("mode").value as FundingMode)
    : "erc20";
}
function invalidate() {
  preparation = undefined;
  $("prepared").hidden = true;
  $("mode-label").hidden = select("chain").value !== "5042002";
  updateButtons();
}
for (const id of ["origin", "name", "chain", "amount"])
  $(id).addEventListener("input", invalidate);
input("amount").addEventListener("input", () => {
  button("send").textContent =
    `Review ${input("amount").value || "…"} USDC deposit in wallet`;
});
function addWallet(wallet: Wallet) {
  if (
    wallets.has(wallet.info.uuid) ||
    [...wallets.values()].some(
      (existing) => existing.provider === wallet.provider,
    )
  )
    return;
  wallets.set(wallet.info.uuid, wallet);
  const option = new Option(wallet.info.name, wallet.info.uuid);
  select("wallet").add(option);
  if (
    wallet.info.rdns?.includes("rainbow") ||
    /rainbow/i.test(wallet.info.name)
  )
    select("wallet").value = wallet.info.uuid;
  updateButtons();
}
window.addEventListener("eip6963:announceProvider", ((
  event: CustomEvent<Wallet>,
) => {
  if (
    typeof event.detail?.provider?.request === "function" &&
    event.detail?.info?.uuid
  )
    addWallet(event.detail);
}) as EventListener);
window.dispatchEvent(new Event("eip6963:requestProvider"));
const ethereum = (
  window as Window & { ethereum?: Provider & { isRainbow?: boolean } }
).ethereum;
if (ethereum)
  addWallet({
    info: {
      uuid: "injected",
      name: ethereum.isRainbow ? "Rainbow" : "Browser wallet",
    },
    provider: ethereum,
  });
select("wallet").addEventListener("change", () => {
  connected = undefined;
  $("account").textContent = "Not connected";
  updateButtons();
});
button("connect").onclick = async () => {
  busy = true;
  updateButtons();
  try {
    const wallet = wallets.get(select("wallet").value);
    if (!wallet)
      throw new Error("Open this page in the browser with Rainbow installed.");
    const accounts = (await wallet.provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accounts[0] || !/^0x[\da-f]{40}$/i.test(accounts[0]))
      throw new Error("The wallet did not return an account.");
    connected = { provider: wallet.provider, account: accounts[0] };
    $("account").textContent = accounts[0];
    notice(
      `${wallet.info.name} connected. Prepare the deposit before signing.`,
    );
  } catch (error) {
    notice(message(error), true);
  } finally {
    busy = false;
    updateButtons();
  }
};
button("prepare").onclick = async () => {
  busy = true;
  preparation = undefined;
  updateButtons();
  try {
    const base = baseUrl(),
      name = `${normalizeLabel(input("name").value)}.eth`,
      chainId = select("chain").value,
      amount = usdcUnits(input("amount").value);
    notice("Retrieving the deposit address and quote…");
    const address = await api<FundingAddress>(base, "/api/v1/address", {
      name,
    });
    const quote = await api<FundingQuote>(base, "/api/v1/quote", {
      name,
      chainId,
      amount,
    });
    if (quote.chainId !== chainId || quote.amount !== amount)
      throw new Error(
        "The quote does not match the requested network and amount.",
      );
    fundingTransaction(address, quote, fundingMode());
    preparation = { base, name, chainId, amount, address, quote };
    $("target").textContent = name;
    $("deposit").textContent = address.depositAddress;
    $("alias").textContent =
      `${address.subname}${address.subnameVerified ? "" : " (not verified; fund the full address)"}`;
    $("duration").textContent =
      `${quote.secondsAdded} seconds · ${(Number(quote.secondsAdded) / 86400).toFixed(2)} days (estimate)`;
    $("expiry").textContent = new Date(quote.expiresAt).toLocaleTimeString();
    $("responses").textContent = JSON.stringify({ address, quote }, null, 2);
    $("prepared").hidden = false;
    notice(
      "Address and quote verified. Review the deposit in your connected wallet.",
    );
  } catch (error) {
    notice(message(error), true);
  } finally {
    busy = false;
    updateButtons();
  }
};
button("send").onclick = async () => {
  if (!preparation || !connected) return;
  busy = true;
  updateButtons();
  const prepared = preparation,
    wallet = connected;
  let entry: Entry | undefined;
  try {
    const tx = fundingTransaction(
      prepared.address,
      prepared.quote,
      fundingMode(),
    );
    const accounts = (await wallet.provider.request({
      method: "eth_accounts",
    })) as string[];
    if (accounts[0]?.toLowerCase() !== wallet.account.toLowerCase())
      throw new Error(
        "The wallet account changed. Connect it again before funding.",
      );
    const currentChain = await wallet.provider.request({
      method: "eth_chainId",
    });
    if (currentChain !== tx.chainId)
      await wallet.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: tx.chainId }],
      });
    if (
      (await wallet.provider.request({ method: "eth_chainId" })) !== tx.chainId
    )
      throw new Error("The wallet did not switch to the source testnet.");
    const finalAccounts = (await wallet.provider.request({
      method: "eth_accounts",
    })) as string[];
    if (finalAccounts[0]?.toLowerCase() !== wallet.account.toLowerCase())
      throw new Error(
        "The wallet account changed during the network switch. Reconnect it.",
      );
    fundingTransaction(prepared.address, prepared.quote, fundingMode());
    entry = {
      id: crypto.randomUUID(),
      base: prepared.base,
      name: prepared.name,
      chainId: prepared.chainId,
      amount: prepared.amount,
      mode: fundingMode(),
      phase: "awaiting_wallet",
      address: prepared.address,
      quote: prepared.quote,
      updates: [],
    };
    entries.unshift(entry);
    save();
    notice(
      "Confirm the deposit in your wallet. Wait for its transaction hash before sending another deposit.",
    );
    const hash = await wallet.provider.request({
      method: "eth_sendTransaction",
      params: [{ from: wallet.account, ...tx }],
    });
    if (typeof hash !== "string" || !/^0x[\da-f]{64}$/i.test(hash))
      throw new Error(
        "The wallet returned no valid transaction hash. Check wallet history before retrying.",
      );
    entry.hash = hash;
    entry.phase = "pending";
    save();
    preparation = undefined;
    notice(
      "Deposit submitted. Polling the source transaction every five seconds.",
    );
    void poll(entry);
  } catch (error) {
    if (entry) {
      entry.phase =
        (error as { code?: number })?.code === 4001
          ? "rejected"
          : "wallet_result_unknown";
      entry.updates.push({
        at: new Date().toISOString(),
        error: message(error),
      });
      save();
    }
    notice(message(error), true);
  } finally {
    busy = false;
    updateButtons();
  }
};
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new DOMException("Stopped", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
async function poll(entry: Entry) {
  if (!entry.hash || polling.has(entry.id)) return;
  const controller = new AbortController();
  polling.set(entry.id, controller);
  renderEntries();
  try {
    while (!controller.signal.aborted) {
      let next = 5000;
      try {
        const status = await api<components["schemas"]["StatusResponse"]>(
          entry.base,
          `/api/v1/status/${entry.chainId}?transactionHash=${entry.hash}`,
          undefined,
          controller.signal,
        );
        if (
          status.chainId !== entry.chainId ||
          status.transactionHash.toLowerCase() !== entry.hash.toLowerCase()
        )
          throw new Error(
            "The status response does not match this source transaction.",
          );
        entry.phase = status.status;
        entry.updates.push({ at: new Date().toISOString(), status });
        save();
        if (status.status === "complete" || status.status === "failed") {
          entry.history = await api(
            entry.base,
            `/api/v1/names/${encodeURIComponent(entry.name)}/renewals`,
            undefined,
            controller.signal,
          );
          save();
          break;
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        entry.updates.push({
          at: new Date().toISOString(),
          error: message(error),
          body: error instanceof RequestError ? error.body : undefined,
        });
        save();
        if (
          !(error instanceof RequestError) ||
          ![404, 429, 503].includes(error.status)
        )
          break;
        next = error.delay;
      }
      await delay(next, controller.signal);
    }
  } finally {
    polling.delete(entry.id);
    renderEntries();
  }
}
function renderEntries() {
  const host = $("runs");
  host.replaceChildren();
  for (const entry of entries) {
    const run = document.createElement("div");
    run.className = "run";
    const heading = document.createElement("div");
    heading.className = "run-heading";
    const title = document.createElement("strong");
    title.textContent = `${entry.name} · ${chainById(Number(entry.chainId))?.network ?? entry.chainId} · ${entry.phase}`;
    heading.append(title);
    if (entry.hash) {
      const control = document.createElement("button");
      control.textContent = polling.has(entry.id)
        ? "Stop polling"
        : "Poll status";
      control.onclick = () => {
        const current = polling.get(entry.id);
        if (current) current.abort();
        else void poll(entry);
      };
      heading.append(control);
    }
    run.append(heading);
    if (entry.hash) {
      const link = document.createElement("a");
      link.href = `${chainById(Number(entry.chainId))?.explorerUrl}/tx/${entry.hash}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = entry.hash;
      link.style.overflowWrap = "anywhere";
      run.append(link);
    }
    if (["awaiting_wallet", "wallet_result_unknown"].includes(entry.phase)) {
      const info = document.createElement("p");
      info.textContent =
        "Check wallet history. Paste the source hash below to resume tracking; do not repeat this payment.";
      run.append(info);
      const hashInput = document.createElement("input");
      hashInput.placeholder = "Source transaction hash";
      hashInput.setAttribute("aria-label", "Recover source transaction hash");
      const recover = document.createElement("button");
      recover.textContent = "Save hash & track";
      recover.onclick = () => {
        if (!/^0x[\da-f]{64}$/i.test(hashInput.value.trim())) {
          notice("Enter a valid transaction hash.", true);
          return;
        }
        entry.hash = hashInput.value.trim().toLowerCase();
        entry.phase = "pending";
        save();
        updateButtons();
        void poll(entry);
      };
      run.append(hashInput, recover);
    }
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      pre = document.createElement("pre");
    summary.textContent = "Status and history evidence";
    pre.textContent = JSON.stringify(entry, null, 2);
    details.append(summary, pre);
    run.append(details);
    host.append(run);
  }
}
button("resume").onclick = () => {
  try {
    const chainId = input("resume-chain").value.trim(),
      hash = input("resume-hash").value.trim().toLowerCase(),
      chain = chainById(Number(chainId));
    if (
      !chain ||
      chain.environment !== "testnet" ||
      !/^0x[\da-f]{64}$/.test(hash)
    )
      throw new Error(
        "Enter a supported testnet chain ID and a transaction hash.",
      );
    const base = baseUrl();
    let entry = entries.find(
      (e) => e.base === base && e.chainId === chainId && e.hash === hash,
    );
    if (!entry) {
      entry = {
        id: crypto.randomUUID(),
        base,
        name: `${normalizeLabel(input("name").value)}.eth`,
        chainId,
        amount: "unknown",
        mode: "erc20",
        hash,
        phase: "pending",
        updates: [],
      };
      entries.unshift(entry);
      save();
    }
    void poll(entry);
  } catch (error) {
    notice(message(error), true);
  }
};
button("export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        { exportedAt: new Date().toISOString(), records: entries },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "namepass-public-api-canaries.json";
  a.click();
  URL.revokeObjectURL(url);
};
renderEntries();
updateButtons();
void api(baseUrl(), "/api/v1/quote", {}).catch((error) =>
  notice(
    error instanceof RequestError && error.status === 400
      ? "Public API is available. Prepare a deposit to start."
      : message(error),
    !(error instanceof RequestError && error.status === 400),
  ),
);
