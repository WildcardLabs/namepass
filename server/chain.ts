import { keccak_256 } from "@noble/hashes/sha3";

import { HUB_CHAIN, SERVER_CHAINS } from "../src/lib/chains";

const text = new TextEncoder();

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function selector(signature: string): string {
	return hex(keccak_256(text.encode(signature))).slice(0, 8);
}

function encodeString(value: string): string {
	const bytes = text.encode(value);
	const padding = (32 - (bytes.length % 32)) % 32;
	return (
		"20".padStart(64, "0") +
		bytes.length.toString(16).padStart(64, "0") +
		hex(bytes) +
		"00".repeat(padding)
	);
}

function word(value: string): bigint {
	if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("The RPC response is not one ABI word.");
	return BigInt(`0x${value}`);
}

function addressWord(value: string): string {
	const valueAsNumber = word(value);
	if (valueAsNumber >= 1n << 160n) throw new Error("The RPC address word has non-zero padding.");
	return `0x${valueAsNumber.toString(16).padStart(40, "0")}`;
}

function booleanWord(value: string): boolean {
	const valueAsNumber = word(value);
	if (valueAsNumber !== 0n && valueAsNumber !== 1n) {
		throw new Error("The RPC boolean word is invalid.");
	}
	return valueAsNumber === 1n;
}

async function calls(
	rpcUrl: string,
	requests: Array<{ to: string; signature: string; args?: string }>,
): Promise<string[]> {
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(
			requests.map((request, id) => ({
				jsonrpc: "2.0",
				id,
				method: "eth_call",
				params: [{ to: request.to, data: `0x${selector(request.signature)}${request.args ?? ""}` }, "latest"],
			})),
		),
	});
	if (!response.ok) throw new Error(`The RPC returned HTTP ${response.status}.`);
	const payload = (await response.json()) as Array<{
		id: number;
		result?: string;
		error?: { message?: string };
	}>;
	if (!Array.isArray(payload)) throw new Error("The RPC response is not a batch.");

	const results = new Array<string>(requests.length);
	const seen = new Set<number>();
	for (const row of payload) {
		if (!Number.isInteger(row.id) || row.id < 0 || row.id >= requests.length || seen.has(row.id)) {
			throw new Error("The RPC response has an invalid ID.");
		}
		seen.add(row.id);
		if (row.error || typeof row.result !== "string") {
			throw new Error(row.error?.message ?? "The RPC response has no result.");
		}
		results[row.id] = row.result.replace(/^0x/, "");
	}
	if (results.some((result) => result === undefined)) throw new Error("The RPC response is incomplete.");
	return results;
}

async function assertRpcChainId(rpcUrl: string, expected: number): Promise<void> {
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] }),
	});
	if (!response.ok) throw new Error(`The RPC returned HTTP ${response.status}.`);
	const payload = (await response.json()) as { id?: unknown; result?: unknown; error?: { message?: string } };
	if (payload.id !== 0 || payload.error || typeof payload.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) {
		throw new Error(payload.error?.message ?? "The RPC chain ID response is invalid.");
	}
	if (BigInt(payload.result) !== BigInt(expected)) {
		throw new Error(`The RPC reports chain ${BigInt(payload.result)}, expected ${expected}.`);
	}
}

function hubRpcUrl(): string {
	const value = process.env[HUB_CHAIN.rpcEnv];
	if (!value) throw new Error(`${HUB_CHAIN.rpcEnv} is not configured.`);
	return value;
}

export interface EnsState {
	expiry: Date | null;
	renewableBy: "registrar" | "v1" | null;
}

export async function readEnsState(label: string): Promise<EnsState> {
	const rpcUrl = hubRpcUrl();
	await assertRpcChainId(rpcUrl, HUB_CHAIN.chainId);
	const [registrarRegistry, v1Registry] = await calls(rpcUrl, [
		{ to: HUB_CHAIN.ensRegistrarAddress!, signature: "ETH_REGISTRY()" },
		{ to: HUB_CHAIN.ensRenewerV1Address!, signature: "ETH_REGISTRY()" },
	]);
	const registry = addressWord(registrarRegistry);
	if (registry !== addressWord(v1Registry)) {
		throw new Error("The ENS renewers report different registries.");
	}

	const [rawExpiry, rawRegistrar, rawV1] = await calls(rpcUrl, [
		{ to: registry, signature: "findExpiry(string)", args: encodeString(label) },
		{ to: HUB_CHAIN.ensRegistrarAddress!, signature: "isRenewable(string)", args: encodeString(label) },
		{ to: HUB_CHAIN.ensRenewerV1Address!, signature: "isRenewable(string)", args: encodeString(label) },
	]);
	const seconds = word(rawExpiry);
	if (seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) {
		throw new Error("The ENS expiry is outside the supported date range.");
	}
	const expiry = seconds === 0n ? null : new Date(Number(seconds) * 1000);
	if (expiry && !Number.isFinite(expiry.getTime())) {
		throw new Error("The ENS expiry is outside the supported date range.");
	}
	const registrar = booleanWord(rawRegistrar);
	const v1 = booleanWord(rawV1);
	return {
		expiry,
		renewableBy: registrar ? "registrar" : v1 ? "v1" : null,
	};
}

export interface BalanceRead {
	chainId: number;
	amount?: string;
}

export async function readNativeUsdcBalances(
	address: string,
	chainIds = SERVER_CHAINS.map((chain) => chain.chainId),
): Promise<BalanceRead[]> {
	const wanted = new Set(chainIds);
	return Promise.all(
		SERVER_CHAINS.filter((chain) => wanted.has(chain.chainId)).map(async (chain) => {
			const rpcUrl = process.env[chain.rpcEnv];
			if (!rpcUrl) return { chainId: chain.chainId };
			try {
				await assertRpcChainId(rpcUrl, chain.chainId);
				const [raw] = await calls(rpcUrl, [
					{
						to: chain.usdcAddress,
						signature: "balanceOf(address)",
						args: address.replace(/^0x/, "").toLowerCase().padStart(64, "0"),
					},
				]);
				return { chainId: chain.chainId, amount: word(raw).toString(10) };
			} catch {
				return { chainId: chain.chainId };
			}
		}),
	);
}

export function labelHash(label: string): string {
	return `0x${hex(keccak_256(text.encode(label)))}`;
}

export function ensNamehash(label: string): string {
	let node: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
	for (const part of `${label}.eth`.split(".").reverse()) {
		const partHash = keccak_256(text.encode(part));
		const input = new Uint8Array(64);
		input.set(node);
		input.set(partHash, 32);
		node = keccak_256(input);
	}
	return `0x${hex(node)}`;
}
