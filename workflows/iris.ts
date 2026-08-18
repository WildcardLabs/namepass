import type { Hex } from "viem";

const HEX = /^0x(?:[0-9a-f]{2})+$/i;

export type IrisPendingReason = "not_found" | "incomplete" | "rate_limited" | "server_error";

export type IrisResult =
	| { kind: "pending"; reason: IrisPendingReason; retryAfterMs: number }
	| { kind: "complete"; message: Hex; attestation: Hex; status: "complete" };

export interface IrisRequest {
	baseUrl: string;
	sourceDomain: number;
	transactionHash: Hex;
	attempt: number;
	initialDelayMs: number;
	maxDelayMs: number;
}

function retryDelay(request: IrisRequest, response?: Response): number {
	const header = response?.headers.get("retry-after");
	if (header && /^\d+$/.test(header)) return Math.min(Number(header) * 1_000, request.maxDelayMs);
	const exponential = Math.min(
		request.initialDelayMs * 2 ** Math.max(0, Math.min(request.attempt, 10)),
		request.maxDelayMs,
	);
	// A bounded random part prevents synchronized workers from polling together.
	return Math.min(Math.round(exponential * (0.75 + Math.random() * 0.5)), request.maxDelayMs);
}

function pending(reason: IrisPendingReason, request: IrisRequest, response?: Response): IrisResult {
	return { kind: "pending", reason, retryAfterMs: retryDelay(request, response) };
}

export async function pollIris(
	request: IrisRequest,
	fetcher: typeof fetch = fetch,
): Promise<IrisResult> {
	if (!/^https:\/\//.test(request.baseUrl)) throw new Error("CIRCLE_IRIS_URL must use HTTPS.");
	if (!/^0x[0-9a-f]{64}$/i.test(request.transactionHash)) throw new Error("The origin transaction hash is invalid.");
	const endpoint = new URL(`/v2/messages/${request.sourceDomain}`, `${request.baseUrl}/`);
	endpoint.searchParams.set("transactionHash", request.transactionHash);
	const response = await fetcher(endpoint, { headers: { accept: "application/json" } });
	if (response.status === 404) return pending("not_found", request, response);
	if (response.status === 429) return pending("rate_limited", request, response);
	if (response.status >= 500) return pending("server_error", request, response);
	if (!response.ok) throw new Error(`Circle Iris returned HTTP ${response.status}.`);

	const payload = (await response.json()) as { messages?: unknown };
	if (!Array.isArray(payload.messages)) throw new Error("Circle Iris returned an invalid response.");
	if (payload.messages.length === 0) return pending("incomplete", request, response);
	if (payload.messages.length !== 1) throw new Error("Circle Iris returned multiple CCTP messages.");
	const row = payload.messages[0];
	if (typeof row !== "object" || row === null) throw new Error("Circle Iris returned an invalid CCTP message.");
	const message = row as Record<string, unknown>;
	if (message.status !== "complete") return pending("incomplete", request, response);
	if (
		typeof message.message !== "string"
		|| !HEX.test(message.message)
		|| message.cctpVersion !== 2
		|| typeof message.attestation !== "string"
		|| !HEX.test(message.attestation)
	) {
		throw new Error("Circle Iris returned an invalid complete attestation.");
	}
	return {
		kind: "complete",
		message: message.message as Hex,
		attestation: message.attestation as Hex,
		status: "complete",
	};
}
