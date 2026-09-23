import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type Hex, type PublicClient } from "viem";
import { bundle, HUB, network, predictWallet, type Plan } from "./model";
import { ensure, type TestTx } from "./canary";
import { download, json } from "./storage";
import { readSourceStatus } from "./source-status";
import { switchNetwork, walletAccount, type WalletChoice } from "./wallet";
import { buildUpgrade, checkUpgrade, exportUpgrade, parseUpgrade, prepareUpgrade, staticUpgradeTx, UPGRADE_LABEL, UPGRADE_ORIGIN, UPGRADE_STEPS, upgradeTitles, verifyUpgradeRecord, type UpgradeRecord, type UpgradeStep } from "./upgrade";

export function UpgradePanel({ plan, wallet, reader, disabled }: { plan: Plan; wallet?: WalletChoice; reader: (id: number) => PublicClient; disabled: boolean }) {
  const key = `namepass:upgrade:v1:${plan.fingerprint}`, upgrade = buildUpgrade(plan);
  const [records, setRecords] = useState<UpgradeRecord[]>([]), recordsRef = useRef<UpgradeRecord[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [storageError, setStorageError] = useState(false);
  const [state, setState] = useState<Awaited<ReturnType<typeof checkUpgrade>>>();
  const [review, setReview] = useState<{ id: UpgradeStep; tx: TestTx; gas: bigint }>();
  const [recoverId, setRecoverId] = useState<UpgradeStep>("deploy"), [recoverHash, setRecoverHash] = useState("");
  const [source, setSource] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => { try { const raw = localStorage.getItem(key); const list = raw ? parseUpgrade(raw, plan).records : []; recordsRef.current = list; setRecords(list); setState(undefined); setReview(undefined); } catch (e) { setStorageError(true); setError((e as Error).message); } };
    sync(); const changed = (e: StorageEvent) => { if (e.key === key) sync(); }; window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [key]);
  const load = () => { const raw = localStorage.getItem(key); return raw ? parseUpgrade(raw, plan).records : []; };
  const save = (next: UpgradeRecord[]) => {
    recordsRef.current = next; setRecords(next);
    try { localStorage.setItem(key, json({ version: 1, fingerprint: plan.fingerprint, records: next })); }
    catch { setStorageError(true); throw new Error("Storage failed. Keep this page open and export rehearsal evidence."); }
  };
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message); } finally { setBusy(false); } }
  async function refresh(list = load()) { const checked = await checkUpgrade(plan, list, reader); save(checked.records); setState(checked); return checked; }
  async function locked(fn: () => Promise<void>) { await navigator.locks.request(key, { ifAvailable: true }, async lock => { ensure(lock, "Another tab is running this rehearsal"); await fn(); }); }
  async function sourceStatus() {
    const verified = await readSourceStatus(HUB, upgrade.helper.address);
    setSource(verified ? "Helper B creation and runtime verified on Sourcify." : "Helper B is not verified yet. Click Publish helper B source to Sourcify, then Check source status."); return verified;
  }
  async function publishSource() { await run(async () => {
    if (await sourceStatus()) return;
    const deployment = load().find(r => r.id === "deploy" && r.status === "verified"); ensure(deployment, "Deploy and verify helper B first");
    ensure((await verifyUpgradeRecord(plan, deployment, reader)).status === "verified", "Deployment receipt failed verification");
    const artifact = bundle.contracts.ENSV2RenewalHelper;
    const response = await fetch(`/sourcify/v2/verify/${HUB}/${upgrade.helper.address}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stdJsonInput: artifact.standardInput, compilerVersion: artifact.compiler, contractIdentifier: `${artifact.source}:ENSV2RenewalHelper`, creationTransactionHash: deployment.hash }) });
    const result = await response.json(); ensure(response.ok, result.message ?? "Sourcify submission failed"); setSource("Source submitted. Click Check source status shortly.");
  }); }
  async function prepare(id: UpgradeStep) { await run(async () => {
    setReview(undefined); ensure(wallet, "Connect Rainbow first"); ensure(await walletAccount(wallet.provider) === plan.config.owner, "Select the deployment wallet");
    const list = load(); save(list); const tx = await prepareUpgrade(plan, id, list, reader);
    if (id === "activate") ensure(await sourceStatus(), "Verify helper B source before activation");
    await switchNetwork(wallet.provider, tx.chainId);
    await reader(tx.chainId).call({ account: plan.config.owner, ...tx });
    setReview({ id, tx, gas: await reader(tx.chainId).estimateGas({ account: plan.config.owner, ...tx }) });
  }); }
  async function submit() {
    if (!review || !wallet) return;
    const selected = review;
    await run(() => locked(async () => {
      const list = load(), tx = await prepareUpgrade(plan, selected.id, list, reader);
      ensure(tx.to === selected.tx.to && tx.data === selected.tx.data && tx.chainId === selected.tx.chainId, "Transaction changed. Review again.");
      if (selected.id === "activate") ensure(await sourceStatus(), "Helper B source verification is incomplete");
      ensure(await walletAccount(wallet.provider) === plan.config.owner && Number(await wallet.provider.request({method:"eth_chainId"})) === tx.chainId, "Wallet account or network changed");
      await reader(tx.chainId).call({ account: plan.config.owner, ...tx }); save(list);
      const signer = createWalletClient({ account: plan.config.owner, chain: network(tx.chainId).chain, transport: custom(wallet.provider) });
      const hash = await signer.sendTransaction({ account: plan.config.owner, chain: network(tx.chainId).chain, to: tx.to, data: tx.data, value: 0n });
      let record: UpgradeRecord = { id: selected.id, hash, status: "pending", tx: { chainId: tx.chainId, to: tx.to, data: tx.data } }; save([...list, record]); setReview(undefined);
      await reader(tx.chainId).waitForTransactionReceipt({ hash, timeout: 60_000, onReplaced: replacement => {
        const old = record.hash; record = { ...record, hash: replacement.transaction.hash }; save(recordsRef.current.map(r => r.hash === old ? record : r));
      } });
      await refresh(recordsRef.current);
    }));
  }
  async function recover() { await run(() => locked(async () => {
    ensure(/^0x[0-9a-f]{64}$/i.test(recoverHash.trim()), "Enter a transaction hash");
    const hash = recoverHash.trim() as Hex, chainId = ["fund", "burn"].includes(recoverId) ? UPGRADE_ORIGIN : HUB;
    const tx = recoverId === "claim" ? { chainId, to: plan.deployments.NamepassL1Gateway.address, data: (await reader(HUB).getTransaction({hash})).input } : staticUpgradeTx(plan, recoverId);
    const record: UpgradeRecord = { id: recoverId, hash, status: "pending", tx: { chainId, to: tx.to, data: tx.data } };
    const result = await verifyUpgradeRecord(plan, record, reader); ensure(result.status === "verified", "Transaction did not complete this step");
    const existing = load(); ensure(!existing.some(r => r.id === recoverId && r.hash !== hash && r.status === "verified"), "Another transaction already completes this step");
    save([...existing.filter(r => r.hash !== hash), { ...record, ...result }]); setRecoverHash(""); await refresh(recordsRef.current);
  })); }
  async function importFile(selected?: File) { if (!selected) return; await run(() => locked(async () => {
    const imported = parseUpgrade(await selected.text(), plan); const existing = load();
    const merged = [...existing, ...imported.records.filter(r => !existing.some(e => e.hash === r.hash))];
    await refresh(merged); setStorageError(false);
  })); }
  const pending = records.some(r => r.status === "pending");
  return <><section className="section-head"><div><div className="eyebrow">05 / HELPER REPLACEMENT</div><h2>One transfer. Two helper deployments.</h2></div><button className="secondary" onClick={() => download("namepass-helper-rehearsal.json", exportUpgrade(plan, recordsRef.current))}>Export rehearsal evidence ↓</button></section>
    <section className="config-card"><p>This rehearsal renews <strong>steve.eth with 1 test USDC from Arc</strong>. Burn while helper A is active. Activate helper B through the {plan.config.delay}-second timelock, then claim the same transfer. Restore helper A afterward. Helper B uses the same reviewed code and ENS addresses. The gateway and deposit addresses stay fixed.</p>
      <dl><dt>Original helper A</dt><dd><code>{plan.deployments.ENSV2RenewalHelper.address}</code></dd><dt>Replacement helper B</dt><dd><code>{upgrade.helper.address}</code></dd><dt>Arc deposit wallet</dt><dd><code>{predictWallet(plan, UPGRADE_LABEL)}</code></dd></dl>
      <p>After step 1, use <strong>Publish helper B source to Sourcify</strong> below, then check its status. Source verification must finish before step 5.</p>
      <p>Use this section until restoration is complete. The original deployment check expects helper A and will flag the temporary switch to B.</p>
      <div className="modal-actions"><button disabled={busy || disabled} onClick={() => run(() => locked(async () => { setReview(undefined); await refresh(); }))}>Check rehearsal state / receipts</button><button className="secondary" disabled={busy} onClick={() => file.current?.click()}>Import rehearsal evidence</button></div>
      <input type="file" accept="application/json" hidden ref={file} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }}/>
      {state && <p>Active helper: <code>{state.active}</code>{state.waitingUntil && <> · Timelock ready after {new Date(state.waitingUntil * 1000).toLocaleString()}. Check state after the delay.</>}</p>}
      {state?.complete && <div className="success">Rehearsal complete. The transfer used helper B, and helper A is restored. Export the evidence.</div>}
      <div className="steps">{UPGRADE_STEPS.map((id, i) => <article className="step" key={id}><div className="step-number">{String(i+1).padStart(2,"0")}</div><div className="step-body"><h3>{upgradeTitles[id]}</h3>{records.filter(r=>r.id===id).map(r=><p key={r.hash}><a href={`${network(r.tx.chainId).explorerUrl}/tx/${r.hash}`} target="_blank" rel="noreferrer">Transaction ↗</a> · {r.status}</p>)}</div><button disabled={busy || disabled || storageError || pending || !wallet || state?.next !== id || !!state?.waitingUntil} onClick={()=>prepare(id)}>Review step →</button></article>)}</div>
      <div className="modal-actions"><button className="secondary" disabled={busy || !records.some(r=>r.id==="deploy"&&r.status==="verified")} onClick={publishSource}>Publish helper B source to Sourcify</button><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await sourceStatus();})}>Check source status</button></div><p>{source}</p>
      <details><summary>Recover a missing rehearsal transaction</summary><p>Receipt recovery only saves local progress. It never sends a transaction.</p><label>Rehearsal step<select value={recoverId} disabled={busy} onChange={e=>setRecoverId(e.target.value as UpgradeStep)}>{UPGRADE_STEPS.map(id=><option key={id} value={id}>{upgradeTitles[id]}</option>)}</select></label><label>Transaction hash<input value={recoverHash} disabled={busy} onChange={e=>setRecoverHash(e.target.value)}/></label><button disabled={busy || !recoverHash.trim()} onClick={recover}>Verify & restore receipt</button></details>
      {error&&<p role="alert" className="bad">{error}</p>}{busy&&<p role="status">Checking receipts or waiting for Rainbow…</p>}
    </section>
    {review&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Review helper rehearsal"><h2>{upgradeTitles[review.id]}</h2><p>{network(review.tx.chainId).network} · Wallet confirms the network fee.</p><dl><dt>Signing wallet</dt><dd><code>{plan.config.owner}</code></dd><dt>Transaction target</dt><dd><code>{review.tx.to}</code></dd><dt>Native value</dt><dd>0</dd><dt>Gas estimate</dt><dd>{review.gas.toString()}</dd></dl><details><summary>Calldata</summary><textarea readOnly value={review.tx.data}/></details><div className="modal-actions"><button className="secondary" disabled={busy} onClick={()=>setReview(undefined)}>Back</button><button disabled={busy || disabled} onClick={submit}>Review in Rainbow ↗</button></div></section></div>}
  </>;
}
