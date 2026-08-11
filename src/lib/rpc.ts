/**
 * The smallest possible `eth_call` client.
 *
 * Not a web3 library and not the start of one. The app makes one kind of
 * request — a batch of `view` calls — and every return type it decodes is
 * listed in `oracle.ts` and `ensName.ts`. A dependency that can also sign
 * transactions would be several hundred kilobytes of surface area for a page
 * that never writes anything.
 *
 * Sending a transaction, decoding a revert reason, or needing a *general* ABI
 * encoder is the signal to stop hand-rolling and take the dependency. The two
 * argument encoders below are fixed-shape on purpose and are not that.
 */

import { keccak_256 } from "@noble/hashes/sha3";

/**
 * Ethereum Sepolia — the hub chain, and the only one worth reading. The
 * factory is deployed to four networks but ENS is only on this one, so this is
 * where the price comes from wherever the money starts.
 *
 * Overridable with `VITE_SEPOLIA_RPC` for anyone who'd rather not depend on a
 * public endpoint. The default is the same one `docs/DEPLOYMENTS.md` uses for
 * its verification commands.
 */
export const SEPOLIA_RPC: string =
	import.meta.env.VITE_SEPOLIA_RPC ||
	"https://ethereum-sepolia-rpc.publicnode.com";

/** A `view` call: contract, function signature, pre-encoded arguments. */
export interface Call {
	to: string;
	/** Solidity signature, e.g. `"getBaseRates()"`. Hashed to a selector here. */
	signature: string;
	/** Already-encoded 32-byte words, if the function takes arguments. */
	args?: string[];
}

export class RpcError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RpcError";
	}
}

const hex = (b: Uint8Array) =>
	Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** First four bytes of `keccak256(signature)`. */
function selector(signature: string): string {
	return hex(keccak_256(new TextEncoder().encode(signature))).slice(0, 8);
}

/** Left-pad an address into a 32-byte word. */
export function encodeAddress(addr: string): string {
	return addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

/**
 * A lone `string` argument — offset, length and padded bytes together.
 *
 * **Only correct as the only argument.** With a second parameter the offset in
 * the head would have to account for it, and this hardcodes `0x20`. That's the
 * line this file stays on the right side of: every call it makes takes either
 * nothing, one address, or one ENS label, so each encoder has exactly one
 * shape to get right. Needing a *general* encoder is still the signal to take
 * a real dependency instead.
 */
export function encodeString(value: string): string {
	const bytes = new TextEncoder().encode(value);
	const pad = (32 - (bytes.length % 32)) % 32;
	return (
		"20".padStart(64, "0") +
		bytes.length.toString(16).padStart(64, "0") +
		hex(bytes) +
		"00".repeat(pad)
	);
}

/**
 * Run every call in one JSON-RPC batch.
 *
 * One request rather than N: the values are read together and only make sense
 * together, and a partial read is a configuration we'd have to reason about
 * rather than a price we can show.
 *
 * Returns each result as a hex string **without** the `0x`, in request order.
 */
export async function ethCallBatch(
	calls: Call[],
	rpcUrl = SEPOLIA_RPC,
): Promise<string[]> {
	const body = calls.map((call, id) => ({
		jsonrpc: "2.0",
		id,
		method: "eth_call",
		params: [
			{
				to: call.to,
				data: `0x${selector(call.signature)}${(call.args ?? []).join("")}`,
			},
			"latest",
		],
	}));

	let res: Response;
	try {
		res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch {
		throw new RpcError(`Could not reach ${new URL(rpcUrl).host}.`);
	}

	if (!res.ok) {
		throw new RpcError(`${new URL(rpcUrl).host} returned HTTP ${res.status}.`);
	}

	const payload = (await res.json()) as
		| Array<{ id: number; result?: string; error?: { message: string } }>
		| { error?: { message: string } };

	/* A batch that fails as a whole comes back as a single object, not an array. */
	if (!Array.isArray(payload)) {
		throw new RpcError(payload.error?.message ?? "Malformed JSON-RPC response.");
	}

	const out = new Array<string>(calls.length);
	for (const row of payload) {
		if (row.error) {
			throw new RpcError(`${calls[row.id]?.signature} reverted: ${row.error.message}`);
		}
		if (typeof row.result !== "string") {
			throw new RpcError(`${calls[row.id]?.signature} returned nothing.`);
		}
		out[row.id] = row.result.replace(/^0x/, "");
	}

	if (out.some((r) => r === undefined)) {
		throw new RpcError("JSON-RPC batch came back short.");
	}
	return out;
}

/*//////////////////////////////////////////////////////////////
                            DECODING
//////////////////////////////////////////////////////////////*/

/**
 * `data` split into 32-byte words. Every ABI type this app reads is either a
 * word or a length-prefixed run of words, so this is the whole decoder.
 */
export function words(data: string): bigint[] {
	if (data.length % 64 !== 0) {
		throw new RpcError("Return data is not a whole number of words.");
	}
	const out: bigint[] = [];
	for (let i = 0; i < data.length; i += 64) {
		out.push(BigInt(`0x${data.slice(i, i + 64)}`));
	}
	return out;
}

/** A single `uint*` return value. */
export function decodeUint(data: string): bigint {
	const w = words(data);
	if (w.length !== 1) throw new RpcError(`Expected one word, got ${w.length}.`);
	return w[0];
}

/** A single `address` return value, lowercase. */
export function decodeAddress(data: string): string {
	const w = words(data);
	if (w.length !== 1) throw new RpcError(`Expected one word, got ${w.length}.`);
	return `0x${w[0].toString(16).padStart(40, "0").slice(-40)}`;
}

/**
 * A dynamic array whose elements are `fields` words each — covers both
 * `uint256[]` (one field) and an array of all-static structs like ENS's
 * `DiscountPoint { uint64; uint128; }` (two, one word apiece).
 */
export function decodeArray(data: string, fields = 1): bigint[][] {
	const w = words(data);
	/* Word 0 is the offset to the array; it is bytes, so /32 gives words. */
	const at = Number(w[0]) / 32;
	if (!Number.isInteger(at) || at >= w.length) {
		throw new RpcError("Array offset out of range.");
	}
	const length = Number(w[at]);
	const rows: bigint[][] = [];
	for (let i = 0; i < length; i++) {
		const start = at + 1 + i * fields;
		if (start + fields > w.length) {
			throw new RpcError("Array is shorter than its declared length.");
		}
		rows.push(w.slice(start, start + fields));
	}
	return rows;
}
