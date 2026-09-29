import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { ApiError, json } from "../http";
import { authenticate, takeQuota, type Partner } from "./auth";
import { API_VERSION, requireEnabled, type Scope } from "./config";
import { decrypt, encrypt } from "./crypto";
import { query, jsonValue, type Executor } from "./store";

export interface Context {
	request: Request;
	partner: Partner;
	body: Record<string, unknown>;
	search: URLSearchParams;
	db: Executor;
}
export interface Result {
	body: unknown;
	status?: number;
}
export type Action = {
	scope: Scope;
	expensive?: boolean;
	idempotent?: boolean;
	run: (context: Context) => Promise<Result>;
};
export type Methods = Partial<
	Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Action>
>;

async function boundedBody(
	request: Request,
): Promise<{ object: Record<string, unknown>; text: string }> {
	if (!request.body) return { object: {}, text: "" };
	const reader = request.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > 8192) {
				await reader.cancel();
				throw new ApiError(
					413,
					"body_too_large",
					"The body must be at most 8192 bytes.",
				);
			}
			chunks.push(part.value);
		}
	} finally {
		reader.releaseLock();
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (!text) return { object: {}, text };
	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/json")
	)
		throw new ApiError(415, "unsupported_media_type", "Use application/json.");
	let object: unknown;
	try {
		object = JSON.parse(text);
	} catch {
		throw new ApiError(400, "invalid_json", "The body must be valid JSON.");
	}
	if (!object || typeof object !== "object" || Array.isArray(object))
		throw new ApiError(400, "invalid_request", "The body must be an object.");
	return { object: object as Record<string, unknown>, text };
}

export function integrationRoute(methods: Methods) {
	return {
		async fetch(request: Request): Promise<Response> {
			const requestId = crypto.randomUUID();
			const headers: Record<string, string> = {
				"cache-control": "no-store",
				"x-request-id": requestId,
				"namepass-api-version": API_VERSION,
				"access-control-allow-origin": "*",
				"access-control-expose-headers":
					"X-Request-Id,Retry-After,Namepass-Api-Version",
			};
			if (request.method === "OPTIONS")
				return new Response(null, {
					status: 204,
					headers: {
						...headers,
						"access-control-allow-methods": [
							...Object.keys(methods),
							"OPTIONS",
						].join(", "),
						"access-control-allow-headers":
							"Authorization,Content-Type,Idempotency-Key",
						"access-control-max-age": "600",
					},
				});
			try {
				requireEnabled();
				if (process.env.NAMEPASS_MAINTENANCE === "1")
					throw new ApiError(503, "maintenance", "Namepass is being upgraded.");
				const action = methods[request.method as keyof Methods];
				if (!action) {
					headers.allow = [...Object.keys(methods), "OPTIONS"].join(", ");
					throw new ApiError(405, "method_not_allowed", "Method not allowed.");
				}
				const partner = await authenticate(request, action.scope);
				const retry = await takeQuota(
					partner,
					request.method === "GET" ? "read" : "write",
				);
				if (retry !== null) {
					headers["retry-after"] = String(retry);
					throw new ApiError(
						429,
						"rate_limited",
						"Retry after the indicated delay.",
					);
				}
				if (action.expensive) {
					const delay = await takeQuota(partner, "expensive");
					if (delay !== null) {
						headers["retry-after"] = String(delay);
						throw new ApiError(
							429,
							"rate_limited",
							"Retry after the indicated delay.",
						);
					}
				}
				const { object: body, text } = await boundedBody(request);
				const url = new URL(request.url);
				const context = {
					request,
					partner,
					body,
					search: url.searchParams,
					db: database(),
				};
				let result: Result;
				if (action.idempotent) {
					const key = request.headers.get("idempotency-key");
					if (!key || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key))
						throw new ApiError(
							400,
							"idempotency_key_required",
							"Use a stable Idempotency-Key of at most 128 characters.",
						);
					const route = `${request.method} ${url.pathname}${url.search}`;
					const fingerprint = createHash("sha256").update(text).digest("hex");
					result = await database().transaction(async (tx) => {
						await tx.execute(
							sql`select pg_advisory_xact_lock(hashtextextended(${`integration:${partner.id}:${route}:${key}`},0))`,
						);
						const [stored] = await query<{
							payload_hash: string;
							response: { ciphertext: string };
							status_code: number;
						}>(
							sql`
            select payload_hash,response,status_code from integration_idempotency
            where partner_id=${partner.id} and route=${route} and key=${key} and expires_at>now()`,
							tx,
						);
						if (stored) {
							if (stored.payload_hash !== fingerprint)
								throw new ApiError(
									409,
									"idempotency_conflict",
									"This key was used with a different request body.",
								);
							return {
								body: JSON.parse(decrypt(stored.response.ciphertext)),
								status: stored.status_code,
							};
						}
						const response = await action.run({ ...context, db: tx });
						await tx.execute(sql`insert into integration_idempotency(partner_id,route,key,payload_hash,response,status_code)
            values(${partner.id},${route},${key},${fingerprint},${jsonValue({ ciphertext: encrypt(JSON.stringify(response.body)) })},${response.status ?? 200})
            on conflict(partner_id,route,key) do update set payload_hash=excluded.payload_hash,response=excluded.response,
            status_code=excluded.status_code,created_at=now(),expires_at=now()+interval '7 days'`);
						return response;
					});
				} else result = await action.run(context);
				// A missed wake is repaired by cron. Never turn a committed command into an HTTP failure.
				if (request.method !== "GET") {
					try {
						await (await import("./wake")).wakeIntegrations();
					} catch {
						/* Durable jobs remain pending. */
					}
				}
				return json(result.body, result.status ?? 200, headers);
			} catch (error) {
				const safe =
					error instanceof ApiError
						? error
						: new ApiError(
								500,
								"internal_error",
								"The request failed. Use the request ID when contacting support.",
							);
				console.info(
					JSON.stringify({
						event: "integration.response",
						requestId,
						code: safe.code,
						status: safe.status,
					}),
				);
				return json(
					{
						error: {
							code: safe.code,
							message: safe.message,
							...(safe.details ? { details: safe.details } : {}),
						},
						requestId,
					},
					safe.status,
					headers,
				);
			}
		},
	};
}

export function segment(request: Request, offset = 1): string {
	const parts = new URL(request.url).pathname.split("/").filter(Boolean);
	try {
		return decodeURIComponent(parts[parts.length - offset]);
	} catch {
		throw new ApiError(
			400,
			"invalid_path",
			"The path contains invalid encoding.",
		);
	}
}
