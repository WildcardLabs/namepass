/**
 * ENS label → Namepass deposit address.
 *
 * **Nothing here is simulated.** This is the same derivation the deployed
 * `NamepassFactory` performs in `predictWallet(string)`, reimplemented in
 * TypeScript so the app can show an address without an RPC round-trip. The
 * factory is on all four testnets at one address (`docs/DEPLOYMENTS.md`), and
 * because the derivation depends on nothing but the factory address and the
 * label, the result is identical on every chain — which is the product promise.
 *
 * Treat this file the way you'd treat a payment address, because that is what
 * it produces. Every constant below is load-bearing:
 *
 * - `NAMEPASS_FACTORY` is the deployed factory. It is *also* the ERC-1167
 *   implementation and the CREATE2 deployer, because a deposit wallet is a
 *   proxy that delegatecalls the factory itself. All three roles are the same
 *   address on purpose — see `contracts/NamepassFactory.sol`.
 * - `SALT_NAMESPACE` is `keccak256("NAMEPASS_DEPOSIT_WALLET_V1")`.
 * - The two ERC-1167 byte strings are the standard minimal-proxy creation code
 *   split around the implementation address.
 *
 * Change any of them and every address this file has ever shown moves.
 *
 * Verified against the chain: `depositAddress("vitalik")` is
 * `0x043c184003266644372bA5fA4946777b3f1cFC3D`, which is what
 * `cast call $FACTORY 'predictWallet(string)(address)' vitalik` returns on all
 * four testnets.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { ens_normalize } from "@adraffy/ens-normalize";

import { HUB_CHAIN, IS_TESTNET } from "./chains";

/**
 * The deployed factory — **testnet set, Sepolia hub**.
 *
 * `hubChainId` is part of the factory's creation code, so a mainnet deployment
 * lands on a different address and therefore derives a different deposit
 * address for every name. The two sets are permanently separate; there is no
 * mainnet factory today. When one exists, this constant and `IS_TESTNET` move
 * together, exactly as `tokens.ts` does.
 */
export const NAMEPASS_FACTORY = HUB_CHAIN.factoryAddress!;

/** `keccak256("NAMEPASS_DEPOSIT_WALLET_V1")` — the factory's salt namespace. */
const SALT_NAMESPACE = keccak_256(utf8("NAMEPASS_DEPOSIT_WALLET_V1"));

/** ERC-1167 minimal proxy creation code, either side of the implementation. */
const PROXY_PREFIX = bytes("3d602d80600a3d3981f3363d3d373d3d3d363d73");
const PROXY_SUFFIX = bytes("5af43d82803e903d91602b57fd5bf3");

/**
 * Longest label ENS will price, in raw UTF-8 bytes. Mirrors the contract's
 * `MAX_LABEL_BYTES` — beyond it the derived address is fundable but can never
 * be renewed against.
 */
const MAX_LABEL_BYTES = 255;

/**
 * Shortest label ENS v2 prices at all. `rateFor()` returns 0 below three
 * characters, so such a name isn't registerable and any payment to its address
 * buys zero time.
 */
const MIN_LABEL_LENGTH = 3;

export type LabelProblem =
	| "empty"
	| "dotted"
	| "too-short"
	| "too-long"
	| "not-normalizable";

/** Human-readable, and safe to render straight into the UI. */
export const LABEL_PROBLEM_TEXT: Record<LabelProblem, string> = {
	empty: "Enter an ENS name.",
	dotted: "Use just the name — subnames aren't supported.",
	"too-short": "ENS names need at least three characters.",
	"too-long": "That name is too long for ENS to price.",
	"not-normalizable": "That isn't a valid ENS name.",
};

export class InvalidLabelError extends Error {
	constructor(readonly problem: LabelProblem) {
		super(LABEL_PROBLEM_TEXT[problem]);
		this.name = "InvalidLabelError";
	}
}

/**
 * ENSIP-15 normalization, plus the constraints the contract enforces.
 *
 * This step is not cosmetic and it is not optional. The factory hashes the
 * exact UTF-8 bytes it is given and cannot normalize — ENSIP-15 isn't
 * reproducible in Solidity — so an un-normalized label derives a
 * *valid-looking* address for a name that no renewal can ever execute against.
 * There is no sweep: money sent there is gone. Normalizing before anyone sees
 * an address is how that gap is closed, and it's why this lives in front of
 * `depositAddress` rather than beside it.
 *
 * Accepts an optional `.eth` suffix for convenience, since every entry point in
 * the app lets people type one. Any *other* dot is rejected rather than
 * stripped — `sub.vitalik.eth` is a different name, not a typo.
 */
export function normalizeLabel(input: string): string {
	const trimmed = input.trim().replace(/\.eth$/i, "");
	if (!trimmed) throw new InvalidLabelError("empty");
	if (trimmed.includes(".")) throw new InvalidLabelError("dotted");

	let normalized: string;
	try {
		normalized = ens_normalize(trimmed);
	} catch {
		throw new InvalidLabelError("not-normalizable");
	}

	/* Code points, not UTF-16 units — ENS counts an emoji as one character and
	   `"👍".length` is 2. */
	if ([...normalized].length < MIN_LABEL_LENGTH) {
		throw new InvalidLabelError("too-short");
	}
	if (utf8(normalized).length > MAX_LABEL_BYTES) {
		throw new InvalidLabelError("too-long");
	}

	return normalized;
}

/**
 * Non-throwing form, for input fields and disabled buttons.
 * Returns `null` when the label is usable.
 */
export function labelProblem(input: string): LabelProblem | null {
	try {
		normalizeLabel(input);
		return null;
	} catch (err) {
		return err instanceof InvalidLabelError ? err.problem : "not-normalizable";
	}
}

/**
 * The permanent USDC deposit address for an ENS label, EIP-55 checksummed.
 *
 * The same address on Ethereum, Base, Arbitrum and Arc. Throws
 * `InvalidLabelError` rather than returning a placeholder: there is no such
 * thing as a fallback payment address, and a caller that hasn't validated its
 * input should find that out here rather than on a card someone is about to
 * send money to.
 */
export function depositAddress(input: string): string {
	if (!IS_TESTNET) {
		/* Deliberately fatal. The address above is the Sepolia-hub factory; on a
		   mainnet set it derives an address nobody controls. */
		throw new Error(
			"No mainnet Namepass factory — deposit addresses cannot be derived.",
		);
	}

	const label = normalizeLabel(input);

	/* salt = keccak256(NAMESPACE ++ keccak256(label)) */
	const labelKey = keccak_256(utf8(label));
	const salt = keccak_256(concat(SALT_NAMESPACE, labelKey));

	/* The proxy's implementation and the CREATE2 deployer are both the factory. */
	const factory = bytes(NAMEPASS_FACTORY);
	const initCodeHash = keccak_256(
		concat(PROXY_PREFIX, factory, PROXY_SUFFIX),
	);

	const create2 = keccak_256(
		concat(Uint8Array.of(0xff), factory, salt, initCodeHash),
	);

	return checksum(create2.slice(12));
}

/** Return an EIP-55 address for public display. */
export function checksumAddress(address: string): string {
	if (!/^0x[0-9a-f]{40}$/i.test(address)) {
		throw new Error("The address must contain 20 hexadecimal bytes.");
	}
	return checksum(bytes(address));
}

/*//////////////////////////////////////////////////////////////
                             HELPERS
//////////////////////////////////////////////////////////////*/

function utf8(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

function bytes(hex: string): Uint8Array {
	const clean = hex.replace(/^0x/, "");
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/**
 * EIP-55 checksum casing. Not decoration — it's what a wallet compares an
 * address against, and the same reason `tokens.ts` says not to reformat the
 * casing of the USDC addresses.
 */
function checksum(addr: Uint8Array): string {
	const lower = Array.from(addr, (b) => b.toString(16).padStart(2, "0")).join("");
	const hash = keccak_256(utf8(lower));
	let out = "0x";
	for (let i = 0; i < lower.length; i++) {
		const nibble = i % 2 === 0 ? hash[i >> 1] >> 4 : hash[i >> 1] & 0x0f;
		out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
	}
	return out;
}
