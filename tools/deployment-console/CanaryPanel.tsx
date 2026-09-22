import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, formatUnits, type Hex, type PublicClient } from "viem";
import { HUB, network, networks, predictWallet, type Plan } from "./model";
import { download, json } from "./storage";
import { switchNetwork, walletAccount, type WalletChoice } from "./wallet";
import { ensure, LABELS, prepareCanary, recoverBurn, snapshot, verifyCanaryReceipt, type Action, type CanaryRecord, type TestTx } from "./canary";

export function Canary({ plan, wallet, reader, disabled }: { plan: Plan; wallet?: WalletChoice; reader: (id: number) => PublicClient; disabled: boolean }) {
  const key = `namepass:canaries:v1:${plan.fingerprint}`;
  const [records, setRecords] = useState<CanaryRecord[]>([]), recordsRef = useRef<CanaryRecord[]>([]);
  const [label, setLabel] = useState<string>(LABELS[0]), [origin, setOrigin] = useState<number>(HUB);
  const [round, setRound] = useState(1);
  const roundRecords = (list: CanaryRecord[]) => list.filter(r => (r.round ?? 1) === (origin === 5042002 ? round : 1));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [state, setState] = useState<Awaited<ReturnType<typeof snapshot>>>();
  const [review, setReview] = useState<{ action: Action; tx: TestTx; gas: bigint }>();
  useEffect(() => {
    try { const saved = localStorage.getItem(key); const list = saved ? JSON.parse(saved) : []; ensure(Array.isArray(list), "Invalid saved test records"); recordsRef.current = list; setRecords(list); }
    catch { setStorageError(true); setError("Saved test records cannot be read. Export the existing browser data before continuing."); }
  }, [key]);
  const save = (next: CanaryRecord[]) => {
    recordsRef.current = next; setRecords(next);
    try { localStorage.setItem(key, json(next)); } catch { setStorageError(true); throw new Error("Storage failed. Keep this page open and export the evidence."); }
  };
  const pending = records.find(r => r.status === "pending");
  const done = (action: Action) => roundRecords(records).some(r => r.label === label && r.origin === origin && r.action === action && r.status === "verified");
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message); } finally { setBusy(false); } }
  async function inspect() { await run(async () => { setReview(undefined); setState(await snapshot(plan, origin, label, reader)); }); }
  async function restoreBurn() {
    await run(async () => {
      await navigator.locks.request(key, { ifAvailable: true }, async lock => {
        ensure(lock, "Another tab is working on this test");
        const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as CanaryRecord[];
        const recovered = await recoverBurn(plan, origin, label, recoveryHash.trim() as Hex, reader);
        ensure(!saved.some(r => r.origin === origin && r.label === label && r.action === "renew" && r.hash !== recovered.hash && r.status !== "reverted"), "A different burn is already recorded");
        save([...saved.filter(r => r.hash !== recovered.hash), recovered]);
        setRecoveryHash(""); setReview(undefined); setState(await snapshot(plan, origin, label, reader));
      });
    });
  }
  async function prepare(action: Action) {
    await run(async () => {
      setReview(undefined); ensure(wallet, "Connect Rainbow first");
      ensure(await walletAccount(wallet.provider) === plan.config.owner, "Select the deployment wallet");
      if (origin === 5042002 && round === 2) ensure(recordsRef.current.some(r => r.origin === origin && r.label === label && (r.round ?? 1) === 1 && r.action === "claim" && r.status === "verified"), "Complete the first Arc renewal before round 2");
      const tx = await prepareCanary(plan, origin, label, action, roundRecords(recordsRef.current), reader, round);
      await switchNetwork(wallet.provider, tx.chainId);
      await reader(tx.chainId).call({ account: plan.config.owner, ...tx });
      const gas = await reader(tx.chainId).estimateGas({ account: plan.config.owner, ...tx });
      setReview({ action, tx, gas });
    });
  }
  async function reconcile(record: CanaryRecord) {
    const result = await verifyCanaryReceipt(plan, record, reader);
    save(recordsRef.current.map(r => r.hash === record.hash ? { ...r, ...result } : r));
    setState(await snapshot(plan, origin, label, reader));
  }
  async function submit() {
    if (!review || !wallet) return;
    const selected = review;
    await run(async () => {
      await navigator.locks.request(key, { ifAvailable: true }, async lock => {
        ensure(lock, "Another tab is working on this test");
        const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as CanaryRecord[];
        recordsRef.current = saved; setRecords(saved);
        const tx = await prepareCanary(plan, origin, label, selected.action, roundRecords(saved), reader, round);
        ensure(tx.to === selected.tx.to && tx.data === selected.tx.data && tx.chainId === selected.tx.chainId && tx.value === selected.tx.value, "Test transaction changed. Review it again.");
        ensure(await walletAccount(wallet.provider) === plan.config.owner && Number(await wallet.provider.request({ method: "eth_chainId" })) === tx.chainId, "Wallet account or network changed");
        await reader(tx.chainId).call({ account: plan.config.owner, ...tx });
        // Check persistent storage before any signature request.
        localStorage.setItem(key, json(saved));
        const client = createWalletClient({ account: plan.config.owner, chain: network(tx.chainId).chain, transport: custom(wallet.provider) });
        const hash = await client.sendTransaction({ account: plan.config.owner, chain: network(tx.chainId).chain, to: tx.to, data: tx.data, value: tx.value });
        let record: CanaryRecord = { label, origin, round: origin === 5042002 ? round : 1, action: selected.action, hash, tx: { chainId: tx.chainId, to: tx.to, data: tx.data }, status: "pending" };
        save([...saved, record]); setReview(undefined);
        await reader(tx.chainId).waitForTransactionReceipt({ hash, timeout: 60_000, onReplaced: replacement => {
          const oldHash = record.hash; record = { ...record, hash: replacement.transaction.hash };
          save(recordsRef.current.map(r => r.hash === oldHash ? record : r));
        } });
        await reconcile(record);
      });
    });
  }
  return <><section className="section-head"><div><div className="eyebrow">04 / LIVE RENEWAL TESTS</div><h2>Prove both ENS paths.</h2></div><button className="secondary" onClick={() => download("namepass-canaries.json", { fingerprint: plan.fingerprint, exportedAt: new Date().toISOString(), records })}>Export test evidence ↓</button></section>
    <section className="config-card"><p>Each test funds the new deposit address with <strong>1 test USDC</strong>. Run both names on each chain: plus a second Arc round for each name: ten tests, 10 test USDC total plus network fees. The renewal uses 0.1 USDC as the executor allowance. Source-chain tests use Circle Standard transfers with no fee allowance.</p>
      <div className="form-grid"><label>ENS name<select disabled={busy || !!review} value={label} onChange={e => { setLabel(e.target.value); setState(undefined); }}>{LABELS.map(name => <option key={name} value={name}>{name}.eth</option>)}</select></label><label>Funding chain<select disabled={busy || !!review} value={origin} onChange={e => { setOrigin(Number(e.target.value)); setState(undefined); }}>{networks.map(n => <option key={n.chainId} value={n.chainId}>{n.network}</option>)}</select></label></div>
      {origin === 5042002 && <label>Arc native deposit round<select disabled={busy || !!review || !!pending} value={round} onChange={e => { setRound(Number(e.target.value)); setState(undefined); }}><option value={1}>1 — before wallet deployment</option><option value={2}>2 — after wallet deployment</option></select></label>}
      <p>New deposit address</p><code className="address">{predictWallet(plan, label)}</code>
      {state && <p>Deposit balance: {formatUnits(state.balance, 6)} USDC · Renewal quote: {(Number(state.duration) / 86400).toFixed(2)} days · Expiry: {new Date(Number(state.expiry) * 1000).toISOString()}<br/>Selected ENS contract: <code>{state.renewer}</code></p>}
      <div className="modal-actions"><button className="secondary" disabled={busy} onClick={inspect}>Check name & balance</button>{(["fund", "renew", ...(origin === HUB ? [] : ["claim"])] as Action[]).map(action => <button key={action} disabled={busy || disabled || storageError || !!pending || done(action) || !wallet} onClick={() => prepare(action)}>{done(action) ? "✓ " : ""}{action === "fund" ? "Review 1 USDC deposit" : action === "renew" ? origin === HUB ? "Review renewal" : "Review CCTP burn" : "Check attestation & review claim"}</button>)}</div>
      {pending && <p>Pending {pending.action}: <code>{pending.hash}</code> <button disabled={busy} onClick={() => run(() => reconcile(pending))}>Check receipt</button></p>}
      {origin !== HUB && round === 1 && <details><summary>Recover a missing source burn</summary><p>If the burn succeeded but its record is missing, restore it by transaction hash. This checks the receipt and saves progress. It does not send a transaction.</p><label>Source burn transaction hash<input value={recoveryHash} disabled={busy} onChange={e => setRecoveryHash(e.target.value)}/></label><button className="secondary" disabled={busy || storageError || !recoveryHash.trim()} onClick={restoreBurn}>Verify & restore burn</button></details>}
      {error && <p role="alert" className="bad">{error}</p>}{busy && <p role="status">Checking chain state or waiting for your wallet…</p>}
      {records.length > 0 && <details><summary>Test transaction records ({records.length})</summary>{records.map(r => <p key={r.hash}>{r.label}.eth · {network(r.origin).network} · {r.action} · {r.status} · <a href={`${network(r.tx.chainId).explorerUrl}/tx/${r.hash}`} target="_blank" rel="noreferrer">Transaction ↗</a></p>)}</details>}
    </section>
    {review && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Review live test"><h2>{review.action} · {label}.eth</h2><p>{network(review.tx.chainId).network} · {review.action === "fund" ? "Transfer 1 test USDC to the deposit address shown below." : "Process the fixed 1 test-USDC renewal."}</p><dl><dt>Deposit address</dt><dd><code>{predictWallet(plan, label)}</code></dd><dt>Transaction target</dt><dd><code>{review.tx.to}</code></dd><dt>Native value</dt><dd>0 · wallet confirms network fees</dd><dt>Gas estimate</dt><dd>{review.gas.toString()}</dd></dl><details><summary>Calldata</summary><textarea readOnly value={review.tx.data}/></details><div className="modal-actions"><button disabled={busy} className="secondary" onClick={() => setReview(undefined)}>Back</button><button disabled={busy || disabled} onClick={submit}>Review in Rainbow ↗</button></div></section></div>}
  </>;
}
