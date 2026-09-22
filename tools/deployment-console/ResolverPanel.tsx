import { useState } from "react";
import { createWalletClient, custom, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, namehash, parseAbi, parseAbiParameters, stringToHex, type Hex, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { SINGLETON, SINGLETON_RUNTIME, predictWallet, type Plan } from "./model";
import { download, json } from "./storage";
import { walletAccount, type WalletChoice } from "./wallet";
import { ENS_REGISTRY, PARENT, resolverArtifact, resolverDeployment, type ResolverConfig } from "./resolver";

const registryAbi = parseAbi(["function owner(bytes32) view returns (address)", "function resolver(bytes32) view returns (address)", "function setResolver(bytes32,address)"]);
const recordsAbi = parseAbi(["function addr(bytes32) view returns (address)", "function text(bytes32,string) view returns (string)"]);
type Record = { config: ResolverConfig; hash?: Hex; verified?: boolean; updateHash?: Hex; active?: boolean };

export function ResolverPanel({ plan, wallet, reader, disabled }: { plan: Plan; wallet?: WalletChoice; reader: (id: number) => PublicClient; disabled: boolean }) {
 const key = `namepass:resolver:mainnet:${plan.fingerprint}`;
 const [record, setRecord] = useState<Record>();
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [notice, setNotice] = useState("Deploy on Ethereum mainnet. Wildcard records will use the new testnet deposit addresses.");
 const [review, setReview] = useState<ReturnType<typeof resolverDeployment>>();
 const save = (value: Record) => { setRecord(value); localStorage.setItem(key, json(value)); };
 const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
 async function checkNetwork() {
  if (await reader(1).getChainId() !== 1) throw new Error("The resolver RPC is not Ethereum mainnet.");
  if ((await reader(1).getCode({ address: SINGLETON }))?.toLowerCase() !== SINGLETON_RUNTIME.toLowerCase()) throw new Error("The mainnet deployment factory bytecode does not match.");
  const owner = await reader(1).readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "owner", args: [namehash(PARENT)] });
  if (owner !== plan.config.owner) throw new Error("The deployment wallet does not own namepass.eth on mainnet.");
 }
 async function verify(value: Record) {
  await checkNetwork();
  const deployment = resolverDeployment(plan, value.config);
  if ((await reader(1).getCode({ address: deployment.address }))?.toLowerCase() !== deployment.runtime.toLowerCase()) throw new Error("The resolver runtime is missing or does not match.");
  for (const label of ["steve", "vitalik"]) {
   const data = await reader(1).readContract({ address: deployment.address, abi: resolverArtifact.abi, functionName: "resolveAddressCallback", args: [encodeAbiParameters(parseAbiParameters("bool"), [true]), stringToHex(label)] }) as Hex;
   const [address] = decodeAbiParameters(parseAbiParameters("address"), data);
   if (address !== predictWallet(plan, label)) throw new Error("The resolver derives a different deposit wallet.");
  }
  // Strings are stored outside runtime bytecode. Verify them independently.
  for (const field of ["avatar", "description", "url", "gatewayUrl"] as const) {
   if (await reader(1).readContract({ address: deployment.address, abi: resolverArtifact.abi, functionName: field }) !== value.config[field]) throw new Error(`Resolver ${field} does not match.`);
  }
  save({ ...value, verified: true }); setReview(undefined);
  setNotice("Resolver deployed and verified. The ENS record is unchanged. After the backend cutover, review the ENS update below.");
 }
 async function prepare() { await run(async () => {
  await checkNetwork();
  const saved = localStorage.getItem(key);
  let value: Record;
  if (saved) value = JSON.parse(saved);
  else {
   const node = namehash(PARENT);
   const current = await reader(1).readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [node] });
   const apex = await reader(1).readContract({ address: current, abi: recordsAbi, functionName: "addr", args: [node] });
   const [avatar, description, url] = await Promise.all(["avatar", "description", "url"].map(field => reader(1).readContract({ address: current, abi: recordsAbi, functionName: "text", args: [node, field] })));
   value = { config: { apex: getAddress(apex), avatar, description, url, gatewayUrl: "https://demo-five-gray-37.vercel.app/api/ccip/{sender}/{data}" } };
  }
  save(value);
  const deployment = resolverDeployment(plan, value.config);
  const code = await reader(1).getCode({ address: deployment.address });
  if (code && code !== "0x") { await verify(value); return; }
  if (value.hash) {
   const receipt = await reader(1).getTransactionReceipt({ hash: value.hash });
   if (receipt.status === "success") throw new Error("The confirmed transaction has no matching resolver code.");
   value = { config: value.config }; save(value);
  }
  await reader(1).call({ account: plan.config.owner, to: SINGLETON, data: deployment.data, value: 0n });
  setReview(deployment);
 }); }
 async function submit() { if (!wallet || !review) return; const approved = review; await run(async () => {
  await navigator.locks.request(key, { ifAvailable: true }, async lock => {
   if (!lock) throw new Error("Another tab is deploying this resolver.");
   await checkNetwork();
   const saved: Record = JSON.parse(localStorage.getItem(key)!);
   if (resolverDeployment(plan, saved.config).data !== approved.data) throw new Error("The resolver configuration changed. Review again.");
   const code = await reader(1).getCode({ address: approved.address });
   if (code && code !== "0x") { await verify(saved); return; }
   if (saved.hash) throw new Error("Check the saved deployment transaction before sending another.");
   await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
   if (await walletAccount(wallet.provider) !== plan.config.owner || Number(await wallet.provider.request({ method: "eth_chainId" })) !== 1) throw new Error("Select the deployment wallet on Ethereum mainnet.");
   await reader(1).call({ account: plan.config.owner, to: SINGLETON, data: approved.data, value: 0n });
   save(saved);
   const signer = createWalletClient({ chain: mainnet, account: plan.config.owner, transport: custom(wallet.provider) });
   let hash = await signer.sendTransaction({ to: SINGLETON, data: approved.data, value: 0n });
   save({ ...saved, hash }); setReview(undefined); setNotice("Mainnet transaction submitted. Waiting for confirmation.");
   await reader(1).waitForTransactionReceipt({ hash, timeout: 60_000, onReplaced: replacement => { hash = replacement.transaction.hash; save({ ...saved, hash }); } });
   await verify({ ...saved, hash });
  });
 }); }
 async function activate() { if (!wallet || !record) return; const value = record; await run(async () => {
  await navigator.locks.request(key, { ifAvailable: true }, async lock => {
   if (!lock) throw new Error("Another tab is updating this resolver.");
   await verify(value);
   const deployment = resolverDeployment(plan, value.config);
   const node = namehash(PARENT);
   const current = await reader(1).readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [node] });
   if (current === deployment.address) { save({ ...value, verified: true, active: true }); setNotice("namepass.eth uses the verified replacement resolver."); return; }
   const saved: Record = JSON.parse(localStorage.getItem(key)!);
   if (saved.updateHash) {
    const receipt = await reader(1).getTransactionReceipt({ hash: saved.updateHash });
    if (receipt.status === "success") throw new Error("Saved update succeeded but ENS points elsewhere. Review the current ENS configuration.");
   }
   await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
   if (await walletAccount(wallet.provider) !== plan.config.owner || Number(await wallet.provider.request({ method: "eth_chainId" })) !== 1) throw new Error("Select the owner wallet on mainnet.");
   const data = encodeFunctionData({ abi: registryAbi, functionName: "setResolver", args: [node, deployment.address] });
   await reader(1).call({ account: plan.config.owner, to: ENS_REGISTRY, data });
   const signer = createWalletClient({ chain: mainnet, account: plan.config.owner, transport: custom(wallet.provider) });
   let hash = await signer.sendTransaction({ to: ENS_REGISTRY, data, value: 0n });
   save({ ...value, verified: true, updateHash: hash });
   await reader(1).waitForTransactionReceipt({ hash, timeout: 60_000, onReplaced: replacement => { hash = replacement.transaction.hash; save({ ...value, verified: true, updateHash: hash }); } });
   if (await reader(1).readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [node] }) !== deployment.address) throw new Error("Resolver update not confirmed. Check the transaction.");
   save({ ...value, verified: true, updateHash: hash, active: true });
   setNotice("namepass.eth now uses the verified replacement resolver and testnet deposit addresses.");
  });
 }); }
 return <section className="verification-card"><div><div className="eyebrow">MAINNET ENS · TESTNET DEPOSIT ADDRESSES</div><h2>Replace the wildcard resolver</h2><p>{notice}</p><p>This deployment spends real ETH on mainnet. It does not update the ENS record or launch mainnet renewals.</p><button className="secondary" disabled={disabled || busy} onClick={prepare}>{busy ? "Checking…" : "Prepare / verify resolver"}</button>{error && <p className="bad">{error}</p>}{record && <><p><code>{resolverDeployment(plan, record.config).address}</code></p>{record.hash && <a href={`https://etherscan.io/tx/${record.hash}`} target="_blank" rel="noreferrer">View mainnet transaction ↗</a>}<button className="secondary" disabled={!record.verified || busy || disabled || !wallet} onClick={activate}>{record.active ? "Verify ENS resolver" : "Review namepass.eth resolver update in Rainbow"}</button><button className="secondary" onClick={() => download("namepass-resolver.json", { chainId: 1, parent: PARENT, factory: plan.deployments.NamepassFactory.address, ...record, deployment: resolverDeployment(plan, record.config) })}>Export resolver evidence</button><button className="secondary" onClick={() => download("NamepassResolver-standard-input.json", resolverArtifact.standardInput)}>Download verification source</button></>}</div>{review && <div><h3>Review mainnet deployment</h3><dl><dt>Parent</dt><dd>{PARENT}</dd><dt>Resolver</dt><dd><code>{review.address}</code></dd><dt>Apex address (preserved)</dt><dd><code>{review.config.apex}</code></dd><dt>CCIP gateway</dt><dd>{review.config.gatewayUrl}</dd><dt>Constructor arguments</dt><dd><textarea readOnly value={review.constructorArgs.slice(2)}/></dd></dl><p>Rainbow will show the gas fee before you sign.</p><button disabled={busy || disabled || !wallet} onClick={submit}>Review mainnet deployment in Rainbow</button><button className="secondary" disabled={busy} onClick={() => setReview(undefined)}>Cancel</button></div>}</section>;
}
