import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPublicClient, formatEther, getAddress, http, keccak256, padHex, type Address, type Hex, type PublicClient } from "viem";
import { buildPlan, bundle, inspectStep, network, networks, preflight, predictWallet, type Check, type Config, type ContractName, type Plan, type Step } from "./model";
import { discover, sendStep, switchNetwork, walletAccount, type WalletChoice } from "./wallet";
import { download, json, manifest, newSession, parseSession, STORAGE_KEY, type Session } from "./storage";
import "./style.css";
import { Canary } from "./CanaryPanel";
import { ResolverPanel } from "./ResolverPanel";
import { UpgradePanel } from "./UpgradePanel";

const readers = new Map<number, PublicClient>();
function reader(chainId: number): PublicClient {
  if (!readers.has(chainId)) readers.set(chainId, createPublicClient({ transport: http(`/rpc/${chainId}`, { timeout: 20_000, retryCount: 1 }), pollingInterval: 2500 }));
  return readers.get(chainId)!;
}
function errorText(error: unknown) { return (error as { shortMessage?: string; message?: string }).shortMessage ?? (error as Error).message ?? "The operation could not finish."; }

function App() {
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [selected, setSelected] = useState<string>("");
  const wallet = wallets.find(w => w.info.uuid === selected);
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [session, setSession] = useState<Session>();
  const sessionRef = useRef<Session>();
  const [config, setConfig] = useState<Config>({ owner: "" as Address, residueRecipient: "" as Address, referrer: `0x${"0".repeat(64)}`, saltLabel: "namepass-testnet-overhaul-2026-09-18", delay: 60 });
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Connect the browser that has your Rainbow extension installed.");
  const [error, setError] = useState("");
  const [storageIssue, setStorageIssue] = useState(false);
  const [review, setReview] = useState<{ step: Step; gas: bigint; fee: bigint }>();
  const [source, setSource] = useState<ContractName>("NamepassFactory");
  const importInput = useRef<HTMLInputElement>(null);
  const plan = useMemo(() => session ? buildPlan(session.config) : undefined, [session?.fingerprint]);
  const updateSession = useCallback((next: Session) => {
    // Persist before asking the wallet or waiting for a receipt. If storage fails, stop.
    sessionRef.current = next; setSession(next);
    try { localStorage.setItem(STORAGE_KEY, json(next)); }
    catch { throw new Error("Browser storage is unavailable. Keep this page open and export the manifest before continuing."); }
  }, []);
  useEffect(() => {
    try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) { const saved = parseSession(stored); sessionRef.current = saved; setSession(saved); setConfig(saved.config); setNotice("Saved deployment loaded. Verify on-chain state to resume."); } } catch (e) { setStorageIssue(true); setError(errorText(e)); }
    return discover(found => setWallets(items => {
      if (items.some(item => item.provider === found.provider || item.info.uuid === found.info.uuid)) return items;
      return [...items, found].sort((a, b) => Number(/rainbow/i.test(b.info.name)) - Number(/rainbow/i.test(a.info.name)));
    }));
  }, []);
  useEffect(() => { if (!selected && wallets.length) setSelected(wallets[0].info.uuid); }, [wallets, selected]);
  useEffect(() => {
    if (!wallet) return;
    const change = () => {
      setReview(undefined);
      void walletAccount(wallet.provider).then(setAccount).catch(() => setAccount(undefined));
      void wallet.provider.request({ method: "eth_chainId" }).then(id => setChainId(Number(id))).catch(() => setChainId(undefined));
    };
    change(); wallet.provider.on?.("accountsChanged", change); wallet.provider.on?.("chainChanged", change); wallet.provider.on?.("disconnect", change);
    return () => { wallet.provider.removeListener?.("accountsChanged", change); wallet.provider.removeListener?.("chainChanged", change); wallet.provider.removeListener?.("disconnect", change); };
  }, [wallet]);
  useEffect(() => {
    if (account && !session) setConfig(previous => ({ ...previous, owner: account, residueRecipient: previous.residueRecipient || account, referrer: previous.owner ? previous.referrer : padHex(account, { size: 32 }) }));
  }, [account, session]);

  async function connect() {
    if (!wallet) { setError("No browser wallet was found. Open this URL in your Rainbow browser."); return; }
    setError(""); setBusy("connect");
    try { setAccount(await walletAccount(wallet.provider, true)); setChainId(Number(await wallet.provider.request({ method: "eth_chainId" }))); }
    catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  }
  async function refresh(target = plan) {
    if (!target) return;
    const output: Record<string, Check> = {};
    const unavailable = new Map<number, string>();
    await Promise.all(networks.map(async n => {
      try { const actual = await reader(n.chainId).getChainId(); if (actual !== n.chainId) throw new Error(`RPC returned chain ${actual}; expected ${n.chainId} (${n.network}). Refresh after the console server restarts.`); }
      catch (e) { unavailable.set(n.chainId, errorText(e)); }
    }));
    for (const step of target.steps) {
      if (unavailable.has(step.chainId)) { output[step.id] = { state: "error", detail: unavailable.get(step.chainId)! }; continue; }
      // Inspect deployments even when prior UI steps are missing so recovery finds existing code.
      if (step.kind !== "deploy" && step.requires.some(id => output[id]?.state !== "complete")) {
        output[step.id] = { state: "blocked", detail: "Complete the preceding contract steps" }; continue;
      }
      try { output[step.id] = await inspectStep(reader(step.chainId), target, step); }
      catch (e) { output[step.id] = { state: "error", detail: errorText(e) }; }
    }
    if (sessionRef.current?.fingerprint === target.fingerprint) setChecks(output);
    return output;
  }
  async function verifyAll() { setBusy("verify"); setError(""); try { await refresh(); setNotice("Verification reads the deployed bytecode and configuration. Saved labels are not trusted."); } catch (e) { setError(errorText(e)); } finally { setBusy(""); } }
  function lockPlan() {
    try {
      if (storageIssue) throw new Error("Import compatible saved progress before starting another deployment.");
      if (!account || getAddress(config.owner) !== account) throw new Error("Connect the wallet that will own this deployment.");
      const next = newSession(config); updateSession(next); setConfig(next.config); setError(""); setNotice("Plan locked. Review the first transaction below.");
      void refresh(buildPlan(next.config));
    } catch (e) { setError(errorText(e)); }
  }
  async function prepare(step: Step) {
    if (!plan || !wallet) return;
    setBusy(step.id); setError(""); setReview(undefined);
    try {
      if (await walletAccount(wallet.provider) !== plan.config.owner) throw new Error("Select the original deployment wallet.");
      await switchNetwork(wallet.provider, step.chainId); setChainId(step.chainId);
      const gas = await preflight(plan, step, reader);
      const gasPrice = await reader(step.chainId).getGasPrice();
      setReview({ step, gas, fee: gas * gasPrice });
    } catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  }
  async function recordReceipt(target: Plan, step: Step, hash: Hex) {
    const client = reader(step.chainId);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000, onReplaced: replacement => {
      const current = sessionRef.current!;
      updateSession({ ...current, journal: { ...current.journal, [step.id]: { ...current.journal[step.id], hash: replacement.transaction.hash } } });
    } });
    const transaction = await client.getTransaction({ hash: receipt.transactionHash });
    if (transaction.from.toLowerCase() !== target.config.owner.toLowerCase() || transaction.to?.toLowerCase() !== step.to.toLowerCase() || transaction.input.toLowerCase() !== step.data.toLowerCase() || transaction.value !== 0n) {
      if (transaction.from.toLowerCase() === target.config.owner.toLowerCase()) {
        const current = sessionRef.current!;
        updateSession({ ...current, journal: { ...current.journal, [step.id]: { ...current.journal[step.id], hash: receipt.transactionHash, status: "cancelled", blockNumber: receipt.blockNumber.toString() } } });
      }
      await refresh(target);
      throw new Error("The wallet mined a different replacement transaction. This step was not completed by that transaction. Verify on-chain state before retrying.");
    }
    const current = sessionRef.current!;
    updateSession({ ...current, journal: { ...current.journal, [step.id]: { ...current.journal[step.id], hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status === "success" ? "confirmed" : "reverted" } } });
    if (receipt.status !== "success") throw new Error("The transaction reverted. Its funds were not applied. Review the error before retrying.");
    const checked = await inspectStep(client, target, step);
    if (checked.state !== "complete") throw new Error("Receipt succeeded, but the expected contract state was not verified.");
    await refresh(target); setNotice(`${step.title} confirmed and verified.`);
  }
  async function submit() {
    if (!review || !wallet || !plan || !session) return;
    const { step } = review;
    setBusy(step.id); setError("");
    try {
      if (!navigator.locks) throw new Error("This browser does not support deployment locking. Use a current browser on localhost.");
      await navigator.locks.request(`namepass-deploy-${plan.fingerprint}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Another tab is processing this deployment. Finish it there first.");
        // Adopt another tab's journal before taking any action.
        const current = parseSession(localStorage.getItem(STORAGE_KEY)!);
        if (current.fingerprint !== plan.fingerprint) throw new Error("The saved deployment changed. Reload this page.");
        updateSession(current);
        const pending = Object.values(current.journal).find(entry => entry.status === "submitted");
        if (pending) throw new Error("A transaction is still awaiting confirmation. Check its receipt first.");
        await preflight(plan, step, reader);
        // This is the only method that requests a signed transaction from Rainbow.
        const hash = await sendStep(wallet.provider, plan, step);
        const latest = sessionRef.current!;
        updateSession({ ...latest, journal: { ...latest.journal, [step.id]: { hash, chainId: step.chainId, dataHash: keccak256(step.data), submittedAt: new Date().toISOString(), status: "submitted" } } });
        setReview(undefined); setNotice(`Transaction submitted on ${network(step.chainId).network}. Waiting for its receipt…`);
        await recordReceipt(plan, step, hash);
      });
    } catch (e) { setError(errorText(e)); setNotice("You can refresh verification or check the saved receipt. Do not send the same step again while it is pending."); }
    finally { setBusy(""); }
  }
  async function checkReceipt(step: Step) {
    if (!plan || !session?.journal[step.id]) return;
    setBusy(step.id); setError("");
    try { await recordReceipt(plan, step, session.journal[step.id].hash); }
    catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  }
  async function importManifest(file?: File) {
    if (!file) return;
    try { const next = parseSession(await file.text()); updateSession(next); setConfig(next.config); setStorageIssue(false); setChecks({}); setReview(undefined); setError(""); await refresh(buildPlan(next.config)); }
    catch (e) { setError(errorText(e)); }
  }
  const complete = plan?.steps.filter(step => checks[step.id]?.state === "complete").length ?? 0;
  const pending = Object.values(session?.journal ?? {}).some(entry => entry.status === "submitted");
  const canSign = Boolean(account && plan && account === plan.config.owner && wallet);
  return <main>
    <header><a className="brand" href="#"><span className="brand-icon">n<span>↗</span></span>namepass<span className="brand-divider"/>deployment console</a><div className="testnet"><span/> TESTNET CONTRACTS · MAINNET ENS</div></header>
    <section className="hero"><div><div className="eyebrow">CONTRACT OVERHAUL · SEPTEMBER 2026</div><h1>A new foundation.<br/><span>One verified step at a time.</span></h1><p>Deploy the fixed gateway, governance pointer, and immutable ENS helper. Your Rainbow wallet signs every transaction.</p></div><aside className="wallet-panel"><div className="small-label">DEPLOYMENT WALLET</div><select aria-label="Browser wallet" value={selected} onChange={e => setSelected(e.target.value)} disabled={!!busy}><option value="" disabled>{wallets.length ? "Choose wallet" : "Looking for browser wallets…"}</option>{wallets.map(w => <option key={w.info.uuid} value={w.info.uuid}>{w.info.name}</option>)}</select>{account ? <><code className="wallet-address">{account}</code><div className="wallet-network">{networks.find(n => n.chainId === chainId)?.network ?? `Chain ${chainId ?? "unknown"}`}</div></> : <p className="muted">Open this page in the browser with your Rainbow extension.</p>}<button onClick={connect} disabled={!!busy || !wallet}>{account ? "Reconnect wallet" : "Connect wallet"}<span>↗</span></button></aside></section>
    <div className="notice" role="status"><span>i</span>{notice}</div>{error && <div className="error" role="alert">{error}</div>}
    <section className="section-head"><div><div className="eyebrow">01 / CONFIGURATION</div><h2>{session ? "Your deployment is locked." : "Set the deployment parameters."}</h2></div><div className="actions"><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={e => { void importManifest(e.target.files?.[0]); e.target.value = ""; }}/><button className="secondary" disabled={!!busy || pending} onClick={() => importInput.current?.click()}>Import progress</button>{session && plan && <button className="secondary" onClick={() => download("namepass-deployment.json", manifest(session, plan, checks))}>Export manifest ↓</button>}</div></section>
    <section className="config-card"><div className="fields"><label>Deployment wallet<input value={config.owner} readOnly placeholder="Connect Rainbow first"/></label><label>Rounding-residue recipient<input value={config.residueRecipient} disabled={!!session} onChange={e => setConfig({ ...config, residueRecipient: e.target.value as Address })} placeholder="0x…"/></label><label>Deployment label<input value={config.saltLabel} disabled={!!session} onChange={e => setConfig({ ...config, saltLabel: e.target.value })}/></label><label>Test timelock delay (seconds)<input type="number" min="60" max="604800" value={config.delay} disabled={!!session} onChange={e => setConfig({ ...config, delay: Number(e.target.value) })}/></label><label className="wide">ENS referrer · 32 bytes<input value={config.referrer} disabled={!!session} onChange={e => setConfig({ ...config, referrer: e.target.value as Hex })}/></label></div><div className="config-footer"><p>Your wallet is the test timelock proposer and executor. The timelock administers itself. <strong>This is not ENS DAO governance.</strong></p>{!session && <button disabled={!account || !!busy || storageIssue} onClick={lockPlan}>Lock deployment plan <span>→</span></button>}{session && !Object.keys(session.journal).length && <button className="secondary" disabled={!!busy} onClick={() => { localStorage.removeItem(STORAGE_KEY); sessionRef.current = undefined; setSession(undefined); setChecks({}); setReview(undefined); }}>Edit configuration</button>}</div></section>
    <section className="section-head"><div><div className="eyebrow">02 / DEPLOYMENT</div><h2>{plan ? `${complete} of ${plan.steps.length} steps verified.` : "Your route to the new contracts."}</h2></div>{plan && <button className="secondary" disabled={!!busy} onClick={verifyAll}>{busy === "verify" ? "Verifying…" : "Verify on-chain state ↻"}</button>}</section>
    {plan ? <><div className="progress-track"><span style={{ width: `${complete / plan.steps.length * 100}%` }}/></div><div className="steps">{plan.steps.map((step, index) => {
      const check = checks[step.id], entry = session?.journal[step.id];
      const dependenciesDone = step.requires.every(id => checks[id]?.state === "complete");
      const done = check?.state === "complete";
      const waiting = check?.state === "waiting";
      const enabled = canSign && !busy && !pending && dependenciesDone && !done && !waiting && check?.state !== "error";
      return <article className={`step ${done ? "done" : ""}`} key={step.id}><div className="step-number">{done ? "✓" : String(index + 1).padStart(2, "0")}</div><div className="step-body"><div className="step-title"><h3>{step.title}</h3><span className={`chain-tag ${network(step.chainId).key}`}>{network(step.chainId).network}</span></div><p>{step.description}</p>{step.deployment && <code className="address">{step.deployment.address}</code>}<div className={`step-detail ${check?.state === "error" ? "bad" : ""}`}>{check?.detail ?? "Verify the network to check this step"}{waiting && check.readyAt && ` · Available after ${new Date(check.readyAt * 1000).toLocaleString()}`}</div>{entry && <a className="tx" target="_blank" rel="noreferrer" href={`${network(step.chainId).explorerUrl}/tx/${entry.hash}`}>View transaction ↗ <span>{entry.status}</span></a>}</div><div className="step-action">{entry?.status === "submitted" ? <button className="secondary" disabled={!!busy} onClick={() => checkReceipt(step)}>Check receipt</button> : done ? <span className="verified">Verified ✓</span> : <button className={enabled ? "" : "secondary"} disabled={!enabled} onClick={() => prepare(step)}>{busy === step.id ? "Working…" : waiting ? "Timelock running" : "Review step →"}</button>}</div></article>;
    })}</div>{complete === plan.steps.length && <div className="success"><h3>On-chain setup verified.</h3><p>Export the manifest. Complete explorer source verification and live renewal canaries before the application cutover and data reset.</p></div>}</> : <div className="empty-route">{["Deploy the L1 contracts", "Queue the timelock change", "Deploy all source factories", "Activate & initialize"].map((name, i) => <div key={name}><span>0{i + 1}</span><h3>{name}</h3><p>{["Sepolia · factory, timelock, pointer, gateway, helper", "The real delay begins when the schedule is mined", "Base Sepolia, Arbitrum Sepolia, and Arc Testnet", "Verify every fixed route and deposit address"][i]}</p></div>)}</div>}
    {plan && <><section className="section-head"><div><div className="eyebrow">03 / RELEASE RECORD</div><h2>Verify the source. Keep the evidence.</h2></div></section><section className="verification-card"><div><label>Contract<select value={source} onChange={e => setSource(e.target.value as ContractName)}>{Object.keys(bundle.contracts).map(name => <option key={name}>{name}</option>)}</select></label><dl><dt>Compiler</dt><dd>{bundle.contracts[source].compiler}</dd><dt>Settings</dt><dd>Shanghai · optimizer 200 · no metadata hash</dd><dt>Contract</dt><dd>{bundle.contracts[source].source}:{source}</dd><dt>Address</dt><dd><code>{plan.deployments[source].address}</code></dd></dl><button className="secondary" onClick={() => download(`${source}-standard-input.json`, bundle.contracts[source].standardInput)}>Download Solidity Standard JSON ↓</button></div><div><p>Open the explorer verification page. Select Solidity Standard JSON Input, upload this file, and use the exact compiler shown here.</p><label>Constructor arguments (ABI-encoded)<textarea readOnly value={plan.deployments[source].constructorArgs.slice(2)}/></label><div className="explorer-links">{(source === "NamepassFactory" ? networks : [networks[0]]).map(n => <a key={n.chainId} href={`${n.explorerUrl}/verifyContract?a=${plan.deployments[source].address}`} target="_blank" rel="noreferrer">{n.network} ↗</a>)}</div></div></section><section className="summary"><div><span className="small-label">SAMPLE DEPOSIT WALLET · VITALIK</span><code>{predictWallet(plan, "vitalik")}</code><p>Same address on all four testnets. Do not publish or fund until initialization is verified.</p></div><div><span className="small-label">BUILD FINGERPRINT</span><code>{bundle.fingerprint}</code><p>The console checks the exact deployed runtime, including constructor immutables.</p></div></section></>}
    {plan && <Canary key={plan.fingerprint} plan={plan} wallet={wallet} reader={reader} disabled={!!busy || !!pending || complete !== plan.steps.length}/> }
    {plan && <UpgradePanel key={`upgrade-${plan.fingerprint}`} plan={plan} wallet={wallet} reader={reader} disabled={!!busy || !!pending}/> }
    {plan && <ResolverPanel plan={plan} wallet={wallet} reader={reader} disabled={!!busy || !!pending}/> }
    <footer><span>namepass / temporary deployment tooling</span><span>Wallet signatures only · No private keys · No database reset here</span></footer>
    {review && plan && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="eyebrow">TRANSACTION REVIEW · {network(review.step.chainId).network}</div><h2 id="review-title">{review.step.title}</h2><p>{review.step.description}</p><dl><dt>Signing wallet</dt><dd><code>{plan.config.owner}</code></dd><dt>Transaction to</dt><dd><code>{review.step.to}</code></dd><dt>Native value</dt><dd>0 {network(review.step.chainId).chain.nativeCurrency.symbol}</dd><dt>Estimated network fee</dt><dd>≈ {formatEther(review.fee)} {network(review.step.chainId).chain.nativeCurrency.symbol} · wallet confirms the final fee</dd><dt>Gas estimate</dt><dd>{review.gas.toString()}</dd></dl><details><summary>Inspect calldata</summary><textarea readOnly value={review.step.data}/></details><div className="modal-actions"><button className="secondary" disabled={!!busy} onClick={() => setReview(undefined)}>Back</button><button disabled={!!busy || !canSign} onClick={submit}>{busy ? "Check your wallet…" : `Review in ${wallet?.info.name ?? "wallet"} ↗`}</button></div></section></div>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
