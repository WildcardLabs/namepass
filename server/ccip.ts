/**
 * CCIP-Read gateway for the `namepass.eth` wildcard resolver (ERC-3668).
 *
 * The resolver reverts `OffchainLookup` for an `addr` query it cannot answer on
 * chain. The client then calls this gateway with the label bytes, and the
 * gateway's job is to register the label so Goldsky watches its deposit address
 * from that moment on. The resolution itself is what enrols a label for
 * tracking — the first time anyone looks a name up, it starts being watched.
 *
 * The gateway returns `abi.encode(true)` to confirm registration. The resolver
 * then computes the deposit address itself from the same label bytes, so the
 * gateway can fail a read but can never forge an address.
 *
 * **Load-bearing invariant:** the resolver derives the deposit address from the
 * exact label bytes in the ENS name (`extraData`). This gateway must watch that
 * same address. So it registers a label only when the bytes are already the
 * ENSIP-15 canonical form (`normalizeLabel(raw) === raw`). A non-canonical label
 * would make the resolver's address and the watched address diverge, so the
 * gateway refuses it instead of tracking a mismatch.
 */

import { eq } from "drizzle-orm";

import { database } from "./db/client";
import { names } from "./db/schema";
import { ApiError, json } from "./http";
import { logOperation } from "./log";
import { activateName } from "./names";
import { InvalidLabelError, normalizeLabel } from "../src/lib/namepass";

/** `abi.encode(true)` — the resolver callback accepts nothing else. */
export const GATEWAY_TRUE =
	"0x0000000000000000000000000000000000000000000000000000000000000001";

/**
 * A gateway request may come from a browser wallet resolving a name, so the
 * response must allow any origin. The request carries no credentials.
 */
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "content-type",
	"access-control-max-age": "86400",
};

/**
 * Turn the resolver's call data into a canonical ENS label.
 *
 * The resolver sends the raw label bytes as the call data, not ABI-encoded
 * arguments. This decodes those bytes, applies ENSIP-15 normalization, and
 * rejects any label that is not already canonical (see the file invariant).
 * Every rejection is a `400`, because the input can never become valid.
 */
export function decodeCcipLabel(dataHex: string): string {
	if (typeof dataHex !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(dataHex)) {
		throw new ApiError(400, "invalid_calldata", "The gateway call data must be 0x-prefixed bytes.");
	}
	const hex = dataHex.slice(2);
	if (!hex) throw new ApiError(400, "invalid_calldata", "The gateway call data is empty.");

	const raw = new Uint8Array(hex.length / 2);
	for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);

	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
	} catch {
		throw new ApiError(400, "invalid_label", "The label is not valid UTF-8 text.");
	}

	let normalized: string;
	try {
		normalized = normalizeLabel(text);
	} catch (error) {
		if (error instanceof InvalidLabelError) {
			throw new ApiError(400, "invalid_label", error.message, { problem: error.problem });
		}
		throw error;
	}

	/* The resolver derives the deposit address from these exact bytes. A
	   non-canonical label would make that address differ from the one this
	   gateway watches, so refuse it rather than track a mismatch. */
	if (normalized !== text) {
		throw new ApiError(400, "label_not_normalized", "The label is not ENS-normalized.");
	}
	return normalized;
}

export interface CcipGatewayDeps {
	/** True when the label already has a name row, so tracking is set. */
	isRegistered(label: string): Promise<boolean>;
	/** Enrol the label for tracking. Idempotent and safe to retry. */
	register(label: string): Promise<void>;
}

/**
 * Decode the label, register it the first time, and confirm with `true`.
 *
 * Repeat resolutions of a known name take the fast path — one indexed read, no
 * ENS round-trip and no balance scan — so a popular name stays cheap to resolve.
 */
export async function handleCcipGateway(dataHex: string, deps: CcipGatewayDeps): Promise<string> {
	const label = decodeCcipLabel(dataHex);
	if (!(await deps.isRegistered(label))) {
		try {
			await deps.register(label);
		} catch (error) {
			/* Registration writes the watched address before the cross-chain
			   balance scan. If that scan fails, the label is still tracked and the
			   recovery cron finishes the scan, so the read may still succeed. Only
			   fail the read when the label did not get tracked at all. */
			if (!(await deps.isRegistered(label))) throw error;
		}
		logOperation("ccip.registered", { step: "ccip_gateway" });
	}
	return GATEWAY_TRUE;
}

export const defaultCcipDeps: CcipGatewayDeps = {
	async isRegistered(label) {
		const rows = await database()
			.select({ id: names.id })
			.from(names)
			.where(eq(names.normalizedLabel, label))
			.limit(1);
		return rows.length > 0;
	},
	async register(label) {
		await activateName(label);
	},
};

/** Answer an ERC-3668 CORS preflight. */
export function corsPreflight(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Run the gateway and map the outcome to an ERC-3668 HTTP response.
 *
 * ERC-3668 clients read the status code: a `4xx` is a permanent failure, so the
 * read gives up; a `5xx` is transient, so the read may retry. A refused label is
 * therefore a `4xx`, and a temporary failure such as an unavailable ENS RPC
 * surfaces as its original `5xx`. The callback only runs on a `200`.
 */
export async function ccipRespond(
	request: Request,
	extractData: (request: Request) => string | Promise<string>,
	deps: CcipGatewayDeps = defaultCcipDeps,
): Promise<Response> {
	const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
	try {
		const dataHex = await extractData(request);
		const data = await handleCcipGateway(dataHex, deps);
		return json({ data }, 200, CORS_HEADERS);
	} catch (error) {
		if (error instanceof ApiError) {
			logOperation("ccip.rejected", { requestId, step: "ccip_gateway", errorCode: error.code });
			return json({ message: error.message }, error.status, CORS_HEADERS);
		}
		logOperation("ccip.error", { requestId, step: "ccip_gateway", errorCode: "internal_error" });
		return json({ message: "The gateway request failed." }, 500, CORS_HEADERS);
	}
}
