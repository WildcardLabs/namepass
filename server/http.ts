import { logOperation } from "./log";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export type Route = (request: Request) => Promise<Response>;

export function handler(method: "GET" | "POST", route: Route) {
	return {
		async fetch(request: Request): Promise<Response> {
			const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
			try {
				if (process.env.NAMEPASS_MAINTENANCE === "1") throw new ApiError(503, "maintenance", "Namepass is being upgraded. Please return shortly.");
				if (request.method !== method) {
					return json(
						{ error: { code: "method_not_allowed", message: "Method not allowed." }, requestId },
						405,
						{ allow: method },
					);
				}
				const response = await route(request);
				logOperation("api.response", {
					requestId,
					step: "request",
					errorCode: response.status >= 400 ? `http_${response.status}` : undefined,
				});
				return response;
			} catch (error) {
				if (error instanceof ApiError) {
					logOperation("api.error", { requestId, step: "request", errorCode: error.code });
					return json(
						{
							error: {
								code: error.code,
								message: error.message,
								...(error.details ? { details: error.details } : {}),
							},
							requestId,
						},
						error.status,
					);
				}
				logOperation("api.error", { requestId, step: "request", errorCode: "internal_error" });
				/* logOperation cannot carry a message or stack. Surface them here so an
				   internal error is diagnosable in the logs instead of an opaque 500. */
				console.error(JSON.stringify({
					event: "api.internal_error",
					requestId,
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				}));
				return json(
					{ error: { code: "internal_error", message: "The request failed." }, requestId },
					500,
				);
			}
		},
	};
}

export function json(
	value: unknown,
	status = 200,
	headers: HeadersInit = {},
): Response {
	return new Response(
		JSON.stringify(value, (_key, item: unknown) =>
			typeof item === "bigint" ? item.toString(10) : item,
		),
		{ status, headers: { ...JSON_HEADERS, ...headers } },
	);
}

export async function readObject(
	request: Request,
	allowedKeys: readonly string[],
): Promise<Record<string, unknown>> {
	const length = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(length) && length > 8_192) {
		throw new ApiError(413, "body_too_large", "The request body is too large.");
	}

	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > 8_192) {
		throw new ApiError(413, "body_too_large", "The request body is too large.");
	}

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ApiError(400, "invalid_request", "The request body must be an object.");
	}

	const object = value as Record<string, unknown>;
	const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
	if (unknown.length) {
		throw new ApiError(400, "invalid_request", "The request contains unknown fields.", {
			fields: unknown,
		});
	}
	return object;
}

export function requiredString(
	object: Record<string, unknown>,
	key: string,
	maxLength: number,
): string {
	const value = object[key];
	if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
		throw new ApiError(400, "invalid_request", `${key} must be a non-empty string.`, {
			field: key,
		});
	}
	return value;
}

function pageLimitInput(request: Request): number {
	const url = new URL(request.url);
	const rawLimit = url.searchParams.get("limit");
	const limit = rawLimit === null ? 20 : Number(rawLimit);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new ApiError(400, "invalid_pagination", "limit must be an integer from 1 to 100.");
	}
	return limit;
}

export function pageInput(request: Request): { limit: number; cursor?: Date } {
	const limit = pageLimitInput(request);
	const url = new URL(request.url);

	const rawCursor = url.searchParams.get("cursor");
	if (!rawCursor) return { limit };
	const cursor = new Date(rawCursor);
	if (Number.isNaN(cursor.getTime())) {
		throw new ApiError(400, "invalid_pagination", "cursor must be an ISO 8601 timestamp.");
	}
	return { limit, cursor };
}

export interface ActivityCursor {
	blockTime: Date;
	eventId: string;
}

export function activityPageInput(request: Request): {
	limit: number;
	cursor?: ActivityCursor;
	page: number;
} {
	const limit = pageLimitInput(request);
	const search = new URL(request.url).searchParams;
	const rawCursor = search.get("cursor");
	const rawPage = search.get("page");
	if (rawCursor && rawPage) {
		throw new ApiError(400, "invalid_pagination", "Use either cursor or page pagination, not both.");
	}
	const page = rawPage === null ? 1 : Number(rawPage);
	if (!Number.isSafeInteger(page) || page < 1) {
		throw new ApiError(400, "invalid_pagination", "page must be a positive safe integer.");
	}
	if (!rawCursor) return { limit, page };
	if (rawCursor.length > 512) {
		throw new ApiError(400, "invalid_pagination", "cursor is not valid activity pagination.");
	}
	try {
		const parsed: unknown = JSON.parse(atob(rawCursor.replace(/-/g, "+").replace(/_/g, "/")));
		if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("invalid cursor");
		const [rawTime, eventId] = parsed;
		if (!Number.isSafeInteger(rawTime) || typeof eventId !== "string") throw new Error("invalid cursor");
		const blockTime = new Date(Number(rawTime));
		if (!Number.isFinite(blockTime.getTime()) || !eventId || eventId.length > 255) {
			throw new Error("invalid cursor");
		}
		return { limit, cursor: { blockTime, eventId }, page: 1 };
	} catch {
		throw new ApiError(400, "invalid_pagination", "cursor is not valid activity pagination.");
	}
}

export function activityCursor(value: ActivityCursor): string {
	return btoa(JSON.stringify([value.blockTime.getTime(), value.eventId]))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function pathSegment(request: Request, before?: string): string {
	const parts = new URL(request.url).pathname.split("/").filter(Boolean);
	const index = before ? parts.lastIndexOf(before) - 1 : parts.length - 1;
	const value = parts[index];
	if (!value) throw new ApiError(400, "invalid_path", "A path value is required.");
	try {
		return decodeURIComponent(value);
	} catch {
		throw new ApiError(400, "invalid_path", "The path value is not valid URL text.");
	}
}
