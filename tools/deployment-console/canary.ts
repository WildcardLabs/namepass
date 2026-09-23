import { decodeEventLog, decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, parseAbi, stringToHex, zeroAddress, zeroHash, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { bundle, HUB, hub, inspectStep, network, predictWallet, type Plan } from "./model";
import { parseCctpMessage } from "../../workflows/cctp";
import { pollIris } from "../../workflows/iris";

export const TEST_AMOUNT = 1_000_000n;
export const LABELS = ["steve", "vitalik"] as const;
export type Action = "fund" | "renew" | "claim";
export type TestTx = { chainId: number; to: Address; data: Hex; value: bigint };
export type CanaryRecord = { label: string; origin: number; round?: number; action: Action; hash: Hex; tx: { chainId: number; to: Address; data: Hex }; status: "pending" | "verified" | "reverted"; evidence?: unknown };
const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function events(receipt: TransactionReceipt, address: Address, abi: typeof erc20Abi | typeof messageAbi | typeof bundle.contracts.NamepassFactory.abi) {
  return receipt.logs.filter(log => same(log.address, address)).flatMap(log => {
    try { return [{ ...decodeEventLog({ abi, topics: log.topics, data: log.data, strict: true }), logIndex: log.logIndex }]; } catch { return []; }
  }) as { eventName: string; args: Record<string, any>; logIndex: number }[];
}
export function validateMessage(plan: Plan, origin: number, label: string, raw: Hex, final: boolean) {
  const message = parseCctpMessage(raw), source = network(origin), gateway = plan.deployments.NamepassL1Gateway.address;
  ensure(origin !== HUB && message.version === 1 && message.burnVersion === 1, "Invalid CCTP version or source");
  ensure(message.sourceDomain === source.circleDomain && message.destinationDomain === 0, "Invalid CCTP domain");
  for (const [actual, expected] of [[message.sender, source.tokenMessengerAddress], [message.recipient, hub.tokenMessengerAddress], [message.destinationCaller, gateway], [message.mintRecipient, gateway], [message.burnToken, source.usdcAddress], [message.messageSender, predictWallet(plan, label)]]) ensure(expected && same(actual!, expected), "CCTP route differs from the new deployment");
  ensure(message.label === label && message.amount === TEST_AMOUNT, "CCTP name or amount differs from this test");
  ensure(message.minFinalityThreshold === 2000 && (!final || message.finalityThresholdExecuted >= 2000), "CCTP finality mismatch");
  ensure(!final || message.nonce !== zeroHash, "CCTP nonce is still a placeholder");
  ensure(message.feeExecuted === 0n, "This test requires a zero-fee Standard transfer");
  return message;
}
export function originEvidence(plan: Plan, origin: number, label: string, receipt: TransactionReceipt) {
  const deposits = events(receipt, plan.deployments.NamepassFactory.address, bundle.contracts.NamepassFactory.abi).filter(e => e.eventName === "DepositProcessed");
  const messages = events(receipt, network(origin).messageTransmitterAddress! as Address, messageAbi).filter(e => e.eventName === "MessageSent");
  ensure(deposits.length === 1 && messages.length === 1, "Expected one deposit and one Circle message");
  const deposit = deposits[0].args;
  ensure(same(deposit.wallet, predictWallet(plan, label)) && deposit.labelKey === keccak256(stringToHex(label)), "Deposit identity mismatch");
  ensure(deposit.amount === TEST_AMOUNT && deposit.remaining === 0n && messages[0].logIndex < deposits[0].logIndex, "Deposit accounting or event order mismatch");
  validateMessage(plan, origin, label, messages[0].args.message, false);
  return { message: messages[0].args.message as Hex, depositLogIndex: deposits[0].logIndex };
}
export function assertAttestedSource(source: Hex, attested: Hex) {
  // Circle replaces nonce, executed finality, feeExecuted, and expirationBlock.
  const stable = (raw: Hex) => [raw.slice(2, 26), raw.slice(90, 290), raw.slice(298, 626), raw.slice(754)].join(":");
  ensure(stable(attested) === stable(source), "Attested message does not match the source burn");
}
export async function checkSetup(plan: Plan, origin: number, reader: (id: number) => PublicClient) {
  for (const step of plan.steps.filter(s => s.chainId === HUB || s.chainId === origin)) ensure((await inspectStep(reader(step.chainId), plan, step)).state === "complete", "Deployment must still match the verified plan");
}
export async function snapshot(plan: Plan, origin: number, label: string, reader: (id: number) => PublicClient) {
  ensure(LABELS.includes(label as typeof LABELS[number]), "Unsupported test name");
  const client = reader(HUB), blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const state = await client.readContract({ address: plan.deployments.ENSV2RenewalHelper.address, abi: bundle.contracts.ENSV2RenewalHelper.abi, functionName: "nameState", args: [label], blockNumber }) as [bigint, Address];
  ensure(state[1] !== zeroAddress, "Name is not renewable");
  const quote = await client.readContract({ address: plan.deployments.ENSV2RenewalHelper.address, abi: bundle.contracts.ENSV2RenewalHelper.abi, functionName: "quote", args: [label, TEST_AMOUNT - 100_000n], blockNumber }) as [bigint, bigint];
  const balance = await reader(origin).readContract({ address: network(origin).usdcAddress! as Address, abi: erc20Abi, functionName: "balanceOf", args: [predictWallet(plan, label)] });
  return { blockNumber, expiry: state[0], renewer: state[1], duration: quote[0], charged: quote[1], balance };
}
export async function prepareCanary(plan: Plan, origin: number, label: string, action: Action, records: CanaryRecord[], reader: (id: number) => PublicClient, round = 1): Promise<TestTx> {
  await checkSetup(plan, origin, reader);
  const current = await snapshot(plan, origin, label, reader), wallet = predictWallet(plan, label);
  const prior = records.filter(r => r.origin === origin && r.label === label);
  ensure(!records.some(r => r.status === "pending"), "Check the pending receipt first");
  ensure(!prior.some(r => r.action === action && r.status === "verified"), "This test step is already verified");
  if (action === "fund") {
    ensure(current.balance === 0n, "The deposit wallet already has USDC. Do not add more for this test.");
    if (origin === 5042002) {
      const code = await reader(origin).getCode({ address: wallet });
      ensure(round === 2 ? !!code && code !== "0x" : !code || code === "0x", "Choose the Arc round that matches the wallet deployment state");
      return { chainId: origin, to: wallet, data: "0x", value: 10n ** 18n };
    }
    return { chainId: origin, to: network(origin).usdcAddress! as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [wallet, TEST_AMOUNT] }), value: 0n };
  }
  if (action === "renew") {
    ensure(current.balance === TEST_AMOUNT, "This test requires exactly 1 USDC in the deposit wallet");
    return { chainId: origin, to: plan.deployments.NamepassFactory.address, data: encodeFunctionData({ abi: bundle.contracts.NamepassFactory.abi, functionName: "renew", args: [label] }), value: 0n };
  }
  ensure(origin !== HUB, "A direct renewal has no CCTP claim");
  const burn = prior.find(r => r.action === "renew" && r.status === "verified");
  ensure(burn, "Verify the source burn first");
  const receipt = await reader(origin).getTransactionReceipt({ hash: burn.hash });
  ensure(receipt.status === "success", "Source transaction failed");
  const source = originEvidence(plan, origin, label, receipt);
  const result = await pollIris({ baseUrl: "https://iris-api-sandbox.circle.com", sourceDomain: network(origin).circleDomain!, transactionHash: burn.hash, messageIndex: 0, attempt: 0, initialDelayMs: 1000, maxDelayMs: 30_000 }, (input, init) => {
    const url = new URL(String(input));
    return fetch(`/iris${url.pathname}${url.search}`, init);
  });
  ensure(result.kind === "complete", "Circle attestation is not ready. Wait, then review the claim again. Do not burn again.");
  validateMessage(plan, origin, label, result.message, true);
  assertAttestedSource(source.message, result.message);
  return { chainId: HUB, to: plan.deployments.NamepassL1Gateway.address, data: encodeFunctionData({ abi: bundle.contracts.NamepassL1Gateway.abi, functionName: "completeCCTP", args: [result.message, result.attestation] }), value: 0n };
}
export async function verifyCanaryReceipt(plan: Plan, record: CanaryRecord, reader: (id: number) => PublicClient) {
  const client = reader(record.tx.chainId), receipt = await client.getTransactionReceipt({ hash: record.hash });
  const tx = await client.getTransaction({ hash: record.hash });
  ensure(same(tx.from, plan.config.owner) && tx.to && same(tx.to, record.tx.to) && tx.input === record.tx.data && tx.value === (record.action === "fund" && record.origin === 5042002 ? 10n ** 18n : 0n), "Mined transaction differs from the reviewed test");
  ensure((await client.getBlock({ blockNumber: receipt.blockNumber })).hash === receipt.blockHash, "Receipt is no longer canonical");
  if (receipt.status !== "success") return { status: "reverted" as const, evidence: { blockNumber: receipt.blockNumber } };
  const wallet = predictWallet(plan, record.label), base = { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
  if (record.action === "fund") {
    if (record.origin === 5042002) {
      ensure(same(tx.to!, wallet) && tx.input === "0x", "Expected a direct native Arc deposit");
      const balanceAt = (blockNumber: bigint) => client.readContract({ address: network(record.origin).usdcAddress! as Address, abi: erc20Abi, functionName: "balanceOf", args: [wallet], blockNumber });
      const [before, after, code] = await Promise.all([balanceAt(receipt.blockNumber - 1n), balanceAt(receipt.blockNumber), client.getCode({ address: wallet, blockNumber: receipt.blockNumber - 1n })]);
      ensure(after - before === TEST_AMOUNT, "Native deposit did not increase the ERC20 USDC balance by 1 USDC");
      ensure(record.round === 2 ? !!code && code !== "0x" : !code || code === "0x", "Wallet deployment state does not match the native deposit round");
      return { status: "verified" as const, evidence: { ...base, balanceBefore: before, balanceAfter: after, walletCodeBefore: code ?? "0x" } };
    }
    const transfer = events(receipt, network(record.origin).usdcAddress! as Address, erc20Abi).find(e => e.eventName === "Transfer" && same(e.args.from, plan.config.owner) && same(e.args.to, wallet) && e.args.value === TEST_AMOUNT);
    ensure(transfer, "Funding transfer not found");
    return { status: "verified" as const, evidence: base };
  }
  if (record.action === "renew" && record.origin !== HUB) return { status: "verified" as const, evidence: { ...base, ...originEvidence(plan, record.origin, record.label, receipt) } };
  const gateway = plan.deployments.NamepassL1Gateway.address, helper = plan.deployments.ENSV2RenewalHelper.address;
  const logs = events(receipt, gateway, bundle.contracts.NamepassL1Gateway.abi);
  const renewed = logs.filter(e => e.eventName === "Renewed"), used = logs.filter(e => e.eventName === "HelperUsed");
  ensure(renewed.length === 1 && used.length === 1, "Missing renewal or helper event");
  const r = renewed[0].args;
  ensure(r.label === record.label && r.labelHash === keccak256(stringToHex(record.label)) && same(r.wallet, wallet) && same(r.executor, plan.config.owner), "Renewal identity mismatch");
  ensure(same(used[0].args.helper, helper) && used[0].args.labelHash === r.labelHash && same(used[0].args.wallet, wallet), "Active helper identity mismatch");
  ensure(r.amountReceived === TEST_AMOUNT && r.gasAllowance === 100_000n && r.amountApplied > 0n && r.amountApplied + r.gasAllowance + r.remainder === TEST_AMOUNT && r.duration > 0n && r.fromCCTP === (record.action === "claim"), "Renewal accounting mismatch");
  if (record.action === "claim") {
    const call = decodeFunctionData({ abi: bundle.contracts.NamepassL1Gateway.abi, data: record.tx.data });
    ensure(call.functionName === "completeCCTP", "Wrong claim function");
    const message = validateMessage(plan, record.origin, record.label, call.args![0] as Hex, true);
    const claims = logs.filter(e => e.eventName === "CCTPClaimed");
    ensure(claims.length === 1 && claims[0].args.nonce === message.nonce && claims[0].logIndex < renewed[0].logIndex && claims[0].args.sourceDomain === network(record.origin).circleDomain && same(claims[0].args.wallet, wallet) && claims[0].args.burnAmount === TEST_AMOUNT && claims[0].args.feeExecuted === 0n && claims[0].args.mintedAmount === TEST_AMOUNT, "Claim accounting mismatch");
  }
  const stateAt = (blockNumber: bigint) => client.readContract({ address: helper, abi: bundle.contracts.ENSV2RenewalHelper.abi, functionName: "nameState", args: [record.label], blockNumber }) as Promise<[bigint, Address]>;
  const [before, after] = await Promise.all([stateAt(receipt.blockNumber - 1n), stateAt(receipt.blockNumber)]);
  ensure(after[0] >= before[0] + r.duration, "Expiry did not increase by the renewal duration");
  for (const [owner, spender] of [[gateway, helper], [helper, after[1]], [wallet, gateway]]) {
    const allowance = await client.readContract({ address: hub.usdcAddress! as Address, abi: erc20Abi, functionName: "allowance", args: [owner, spender], blockNumber: receipt.blockNumber });
    ensure(allowance === 0n, "Settlement left a token allowance");
  }
  return { status: "verified" as const, evidence: { ...base, renewal: r, expiryBefore: before[0], expiryAfter: after[0], allowancesZero: true } };
}

export async function recoverBurn(plan: Plan, origin: number, label: string, hash: Hex, reader: (id: number) => PublicClient): Promise<CanaryRecord> {
  ensure(origin !== HUB && LABELS.includes(label as typeof LABELS[number]), "Choose a source chain and supported name");
  ensure(/^0x[0-9a-f]{64}$/i.test(hash), "Enter a transaction hash");
  ensure(await reader(origin).getChainId() === origin, "RPC chain mismatch");
  const record: CanaryRecord = {
    label, origin, action: "renew", hash, status: "pending",
    tx: { chainId: origin, to: plan.deployments.NamepassFactory.address, data: encodeFunctionData({ abi: bundle.contracts.NamepassFactory.abi, functionName: "renew", args: [label] }) },
  };
  const result = await verifyCanaryReceipt(plan, record, reader);
  ensure(result.status === "verified", "The source burn did not succeed");
  return { ...record, ...result };
}
