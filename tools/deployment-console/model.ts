import {
  concat, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, getCreate2Address,
  keccak256, padHex, stringToHex, toHex, zeroAddress, zeroHash,
  type Abi, type Address, type Hex, type PublicClient,
} from "viem";
import { sepolia, baseSepolia, arbitrumSepolia, arcTestnet } from "viem/chains";
import { STABLE_TESTNET_CHAINS } from "../../src/lib/chains";
import generated from "./generated/bundle.json";

export const HUB = sepolia.id;
export const SINGLETON = getAddress("0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7");
export const SINGLETON_RUNTIME: Hex = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
export const REGISTRAR = getAddress("0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca");
export const RENEWER = getAddress("0xd06e726e9bd8ac0f33a2a45f4cc28fe10d656a36");
const chainDefinitions = [sepolia, baseSepolia, arbitrumSepolia, arcTestnet];
export const networks = ["ethereum", "base", "arbitrum", "arc"].map(key => {
  const registry = STABLE_TESTNET_CHAINS.find(chain => chain.key === key)!;
  return { ...registry, chain: chainDefinitions.find(chain => chain.id === registry.chainId)! };
});
export const hub = networks[0];
export function network(id: number) {
  const found = networks.find(item => item.chainId === id);
  if (!found) throw new Error("Only the four configured testnets are supported.");
  return found;
}
export type ContractName = "NamepassFactory" | "TimelockController" | "RenewalHelperPointer" | "NamepassL1Gateway" | "ENSV2RenewalHelper";
type Artifact = { abi: Abi; bytecode: Hex; runtime: Hex; immutables: { variable: string; positions: { start: number; length: number }[] }[]; compiler: string; source: string; standardInput: unknown };
export const bundle = generated as unknown as { fingerprint: Hex; contracts: Record<ContractName, Artifact> };
export type Config = { owner: Address; residueRecipient: Address; referrer: Hex; saltLabel: string; delay: number };
export type Deployment = { name: ContractName; address: Address; salt: Hex; initcode: Hex; runtime: Hex; args: readonly unknown[]; constructorArgs: Hex };
export type Step = { id: string; chainId: number; title: string; description: string; kind: "deploy" | "schedule" | "activate" | "initialize"; deployment?: Deployment; to: Address; data: Hex; requires: string[] };
export type Plan = { config: Config; fingerprint: Hex; deployments: Record<ContractName, Deployment>; steps: Step[]; updateData: Hex; operationId: Hex; operationSalt: Hex };
export type Check = { state: "ready" | "complete" | "waiting" | "blocked" | "error"; detail: string; readyAt?: number };

export function normalizeConfig(raw: Config): Config {
  const owner = getAddress(raw.owner), residueRecipient = getAddress(raw.residueRecipient);
  if (owner === zeroAddress || residueRecipient === zeroAddress) throw new Error("Wallet and residue recipient must be nonzero addresses.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw.referrer)) throw new Error("Referrer must contain exactly 32 bytes.");
  if (!raw.saltLabel.trim() || raw.saltLabel.length > 100 || raw.saltLabel === "namepass") throw new Error("Choose a new deployment label, with 1–100 characters.");
  if (!Number.isSafeInteger(raw.delay) || raw.delay < 60 || raw.delay > 604800) throw new Error("Use a test timelock delay between 60 seconds and 7 days.");
  return { owner, residueRecipient, referrer: raw.referrer.toLowerCase() as Hex, saltLabel: raw.saltLabel.trim(), delay: raw.delay };
}

export function expectedRuntime(name: ContractName, values: Record<string, Address | Hex | bigint>): Hex {
  const artifact = bundle.contracts[name];
  let code = artifact.runtime.slice(2);
  for (const { variable, positions } of artifact.immutables) {
    const value = values[variable];
    if (value === undefined) throw new Error(`Missing immutable ${name}.${variable}.`);
    const word = padHex(typeof value === "bigint" ? toHex(value) : value, { size: 32 }).slice(2).toLowerCase();
    for (const { start, length } of positions) {
      if (length !== 32) throw new Error("Unsupported immutable length.");
      code = code.slice(0, start * 2) + word + code.slice((start + length) * 2);
    }
  }
  return `0x${code}`;
}

export function buildPlan(raw: Config): Plan {
  const config = normalizeConfig(raw);
  const deployments = {} as Record<ContractName, Deployment>;
  function deploy(name: ContractName, args: readonly unknown[], values: Record<string, Address | Hex | bigint>): Deployment {
    const artifact = bundle.contracts[name];
    const initcode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const salt = keccak256(stringToHex(`${config.saltLabel}:${name}`));
    const address = getCreate2Address({ from: SINGLETON, salt, bytecode: initcode });
    const runtime = expectedRuntime(name, { ...values, SELF: address });
    const result = { name, address, salt, initcode, runtime, args, constructorArgs: `0x${initcode.slice(artifact.bytecode.length)}` as Hex };
    deployments[name] = result;
    return result;
  }
  const factory = deploy("NamepassFactory", [config.owner, BigInt(HUB)], { HUB_CHAIN_ID: BigInt(HUB) });
  const timelock = deploy("TimelockController", [BigInt(config.delay), [config.owner], [config.owner], zeroAddress], {});
  const pointer = deploy("RenewalHelperPointer", [factory.address, hub.usdcAddress, timelock.address], { factory: factory.address, paymentToken: hub.usdcAddress as Address });
  const gateway = deploy("NamepassL1Gateway", [factory.address, hub.usdcAddress, hub.messageTransmitterAddress, hub.tokenMessengerAddress, pointer.address, config.residueRecipient], {
    factory: factory.address, paymentToken: hub.usdcAddress as Address, USDC: hub.usdcAddress as Address,
    pointer: pointer.address, MESSAGE_TRANSMITTER: hub.messageTransmitterAddress as Address,
    TOKEN_MESSENGER: hub.tokenMessengerAddress as Address, residueRecipient: config.residueRecipient,
  });
  const helper = deploy("ENSV2RenewalHelper", [gateway.address, factory.address, hub.usdcAddress, REGISTRAR, RENEWER, config.referrer], {
    gateway: gateway.address, factory: factory.address, paymentToken: hub.usdcAddress as Address,
    USDC: hub.usdcAddress as Address, ethRegistrar: REGISTRAR, ethRenewerV1: RENEWER, referrer: config.referrer,
  });
  const updateData = encodeFunctionData({ abi: bundle.contracts.RenewalHelperPointer.abi, functionName: "setHelper", args: [helper.address] });
  const operationSalt = keccak256(stringToHex(`${config.saltLabel}:activate-helper`));
  const callArgs = [pointer.address, 0n, updateData, zeroHash, operationSalt] as const;
  const operationId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }], callArgs));
  const steps: Step[] = [];
  function deploymentStep(d: Deployment, chainId: number, requires: string[]) {
    const id = `deploy-${d.name}-${chainId}`;
    steps.push({ id, chainId, title: `Deploy ${d.name.replace("Namepass", "").replace("Controller", "")}`, description: `Deploy the reviewed ${d.name} bytecode through the verified Safe Singleton Factory.`, kind: "deploy", deployment: d, to: SINGLETON, data: concat([d.salt, d.initcode]), requires });
    return id;
  }
  const f = deploymentStep(factory, HUB, []);
  const t = deploymentStep(timelock, HUB, [f]);
  const p = deploymentStep(pointer, HUB, [f, t]);
  const g = deploymentStep(gateway, HUB, [p]);
  const h = deploymentStep(helper, HUB, [g]);
  steps.push({ id: "schedule", chainId: HUB, kind: "schedule", title: "Schedule helper activation", description: `Queue the pointer change. The ${config.delay}-second delay starts when this transaction is mined.`, requires: [h], to: timelock.address, data: encodeFunctionData({ abi: bundle.contracts.TimelockController.abi, functionName: "schedule", args: [...callArgs, BigInt(config.delay)] }) });
  for (const source of networks.slice(1)) deploymentStep(factory, source.chainId, ["schedule"]);
  steps.push({ id: "activate", chainId: HUB, kind: "activate", title: "Activate the immutable helper", description: "Execute the queued operation after the delay. This binds the gateway and selects the helper.", requires: ["schedule"], to: timelock.address, data: encodeFunctionData({ abi: bundle.contracts.TimelockController.abi, functionName: "execute", args: callArgs }) });
  for (const chain of networks) {
    const messenger = chain.chainId === HUB ? zeroAddress : chain.tokenMessengerAddress!;
    steps.push({ id: `initialize-${chain.chainId}`, chainId: chain.chainId, kind: "initialize", title: `Initialize ${chain.name} factory`, description: "Permanently set this chain's USDC, Circle messenger, and the shared Ethereum gateway.", requires: ["activate", `deploy-NamepassFactory-${chain.chainId}`], to: factory.address, data: encodeFunctionData({ abi: bundle.contracts.NamepassFactory.abi, functionName: "initialize", args: [chain.usdcAddress, messenger, gateway.address] }) });
  }
  const fingerprint = keccak256(stringToHex(JSON.stringify({ artifact: bundle.fingerprint, config })));
  return { config, fingerprint, deployments, steps, updateData, operationId, operationSalt };
}

const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
async function read(client: PublicClient, plan: Plan, contract: ContractName, fn: string, args: readonly unknown[] = []): Promise<unknown> {
  return client.readContract({ address: plan.deployments[contract].address, abi: bundle.contracts[contract].abi, functionName: fn, args });
}
export async function requireCode(client: PublicClient, address: Address, expected?: Hex) {
  const code = await client.getBytecode({ address });
  if (!code || code === "0x") throw new Error(`No deployed code at ${address}.`);
  if (expected && !same(code, expected)) throw new Error(`Bytecode mismatch at ${address}. Stop and inspect this deployment.`);
}
export async function verifyDeployment(client: PublicClient, plan: Plan, deployment: Deployment) {
  await requireCode(client, deployment.address, deployment.runtime);
  const name = deployment.name;
  if (name === "NamepassFactory" && !same(await read(client, plan, name, "owner"), plan.config.owner)) throw new Error("Factory owner differs from the deployment wallet.");
  if (name === "TimelockController") {
    if (!same(await read(client, plan, name, "getMinDelay"), plan.config.delay)) throw new Error("Timelock delay differs from this plan.");
    for (const role of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
      const id = await read(client, plan, name, role);
      if (!await read(client, plan, name, "hasRole", [id, plan.config.owner])) throw new Error(`Wallet lacks ${role}.`);
    }
    if (await read(client, plan, name, "hasRole", [zeroHash, plan.config.owner])) throw new Error("Wallet unexpectedly has an immediate admin role.");
    if (!await read(client, plan, name, "hasRole", [zeroHash, deployment.address])) throw new Error("Timelock self-administration is missing.");
  }
  if (name === "RenewalHelperPointer") {
    if (!same(await read(client, plan, name, "ensGovernanceExecutor"), plan.deployments.TimelockController.address)) throw new Error("Pointer governance differs from this plan.");
    for (const [getter, expected] of [["gateway", plan.deployments.NamepassL1Gateway.address], ["currentHelper", plan.deployments.ENSV2RenewalHelper.address]] as const) {
      const value = await read(client, plan, name, getter);
      if (!same(value, zeroAddress) && !same(value, expected)) throw new Error(`Pointer ${getter} differs from this plan.`);
    }
    if (!same(await read(client, plan, name, "pendingGovernanceExecutor"), zeroAddress)) throw new Error("Unexpected pending governance transfer.");
  }
}

export async function inspectStep(client: PublicClient, plan: Plan, step: Step): Promise<Check> {
  if (step.kind === "deploy") {
    const d = step.deployment!;
    const code = await client.getBytecode({ address: d.address });
    if (!code || code === "0x") return { state: "ready", detail: "Ready to deploy" };
    await verifyDeployment(client, plan, d);
    return { state: "complete", detail: "Bytecode and configuration verified" };
  }
  if (step.kind === "initialize") {
    await verifyDeployment(client, plan, plan.deployments.NamepassFactory);
    const params = await read(client, plan, "NamepassFactory", "walletParams") as readonly unknown[];
    if (same(params[2], zeroAddress)) return { state: "ready", detail: "Ready to initialize" };
    const n = network(step.chainId);
    const expected = [n.usdcAddress, step.chainId === HUB ? zeroAddress : n.tokenMessengerAddress, plan.deployments.NamepassL1Gateway.address, step.chainId === HUB ? 0 : 2000];
    if (!params.every((value, i) => same(value, expected[i]))) throw new Error("Factory is initialized with different settings. Its settings cannot be replaced.");
    const wallet = await client.readContract({ address: step.to, abi: bundle.contracts.NamepassFactory.abi, functionName: "predictWallet", args: ["vitalik"] });
    if (!same(wallet, predictWallet(plan, "vitalik"))) throw new Error("Deposit wallet derivation differs from the expected CREATE2 address.");
    return { state: "complete", detail: "USDC, Circle route, finality, and deposit derivation verified" };
  }
  await verifyDeployment(client, plan, plan.deployments.TimelockController);
  await verifyDeployment(client, plan, plan.deployments.RenewalHelperPointer);
  const timestamp = Number(await read(client, plan, "TimelockController", "getTimestamp", [plan.operationId]));
  if (step.kind === "schedule") return timestamp > 0 ? { state: "complete", detail: timestamp === 1 ? "Operation executed" : "Operation scheduled" } : { state: "ready", detail: "Ready to schedule" };
  if (timestamp === 1) {
    if (!same(await read(client, plan, "RenewalHelperPointer", "currentHelper"), plan.deployments.ENSV2RenewalHelper.address) || !same(await read(client, plan, "RenewalHelperPointer", "gateway"), plan.deployments.NamepassL1Gateway.address)) throw new Error("Completed operation does not match the pointer state.");
    return { state: "complete", detail: "Helper active; gateway permanently bound" };
  }
  if (timestamp === 0) return { state: "blocked", detail: "Schedule the activation first" };
  const block = await client.getBlock();
  if (BigInt(timestamp) > block.timestamp) return { state: "waiting", detail: "Timelock delay is still running", readyAt: timestamp };
  return { state: "ready", detail: "Timelock delay complete; ready to execute" };
}

export function predictWallet(plan: Plan, label: string): Address {
  const factory = plan.deployments.NamepassFactory.address;
  const salt = keccak256(concat([keccak256(stringToHex("NAMEPASS_DEPOSIT_WALLET_V1")), keccak256(stringToHex(label))]));
  const initcode = concat(["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", factory, "0x5af43d82803e903d91602b57fd5bf3"]);
  return getCreate2Address({ from: factory, salt, bytecode: initcode });
}

export async function preflight(plan: Plan, step: Step, reader: (chainId: number) => PublicClient) {
  const client = reader(step.chainId);
  if (await client.getChainId() !== step.chainId) throw new Error("RPC returned the wrong chain ID.");
  await requireCode(client, SINGLETON, SINGLETON_RUNTIME);
  for (const id of step.requires) {
    const dependency = plan.steps.find(s => s.id === id)!;
    const other = reader(dependency.chainId);
    if (await other.getChainId() !== dependency.chainId) throw new Error("Dependency RPC returned the wrong chain ID.");
    const state = await inspectStep(other, plan, dependency);
    if (state.state !== "complete") throw new Error(`Complete “${dependency.title}” first.`);
  }
  const state = await inspectStep(client, plan, step);
  if (state.state !== "ready") throw new Error(state.state === "complete" ? "This step is already complete. Refresh verification." : state.detail);
  // The local hub route must already be fully reviewed before source-chain initialization.
  if (step.kind === "initialize") {
    const hubClient = reader(HUB);
    for (const d of Object.values(plan.deployments)) await verifyDeployment(hubClient, plan, d);
  }
  const n = network(step.chainId);
  if (step.kind === "initialize") {
    await requireCode(client, n.usdcAddress as Address);
    if (step.chainId !== HUB) await requireCode(client, n.tokenMessengerAddress as Address);
  }
  await client.call({ account: plan.config.owner, to: step.to, data: step.data, value: 0n });
  return client.estimateGas({ account: plan.config.owner, to: step.to, data: step.data, value: 0n });
}
