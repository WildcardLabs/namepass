import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { ApiError } from "../http";

export function endpointUrl(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048)
		throw new ApiError(400, "invalid_endpoint", "Use a public HTTPS URL.");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ApiError(400, "invalid_endpoint", "Use a public HTTPS URL.");
	}
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.hash ||
		(url.port && url.port !== "443") ||
		isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
		!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
	) {
		throw new ApiError(
			400,
			"invalid_endpoint",
			"Use a public HTTPS hostname on port 443, without credentials or fragments.",
		);
	}
	return url.toString();
}
export function publicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		const [a, b, c] = address.split(".").map(Number);
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 &&
				(b === 168 ||
					b === 0 ||
					(b === 88 && c === 99) ||
					(b === 2 && c === 0))) ||
			(a === 198 && (b === 18 || b === 19 || b === 51)) ||
			(a === 203 && b === 0 && c === 113)
		);
	}
	if (family !== 6) return false;
	const lower = address.toLowerCase(),
		first = parseInt(lower.split(":")[0], 16);
	// Only globally routed unicast; reject transition/documentation/benchmark ranges.
	return (
		first >= 0x2000 &&
		first <= 0x3fff &&
		!(
			first === 0x2001 &&
			(parseInt(lower.split(":")[1] || "0", 16) < 0x200 ||
				parseInt(lower.split(":")[1], 16) === 0xdb8)
		) &&
		!lower.startsWith("2002:") &&
		!lower.startsWith("3fff:")
	);
}
export async function sendWebhook(
	urlValue: string,
	body: string,
	headers: Record<string, string>,
): Promise<{ status: number; retryAfter: number | null }> {
	const url = new URL(endpointUrl(urlValue));
	const started = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const records = await Promise.race([
		lookup(url.hostname, { all: true, verbatim: true }),
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("dns_timeout")), 5000);
		}),
	]).finally(() => clearTimeout(timer));
	if (!records.length || records.some((row) => !publicAddress(row.address)))
		throw new Error("unsafe_destination");
	const pinned = records[0];
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: "POST",
				agent: false,
				servername: url.hostname,
				headers: {
					...headers,
					"content-type": "application/json",
					"content-length": Buffer.byteLength(body),
					"user-agent": "Namepass-Webhooks/1",
				},
				lookup: (_host, options, callback) => {
					if (options.all)
						(
							callback as unknown as (
								error: null,
								addresses: typeof records,
							) => void
						)(null, [pinned]);
					else callback(null, pinned.address, pinned.family);
				},
			},
			(response) => {
				let size = 0;
				response.on("data", (chunk) => {
					size += chunk.length;
					if (size > 32768) response.destroy(new Error("response_too_large"));
				});
				response.on("error", reject);
				response.on("end", () => {
					const raw = response.headers["retry-after"];
					const seconds =
						typeof raw === "string"
							? /^\d+$/.test(raw)
								? Number(raw)
								: (Date.parse(raw) - Date.now()) / 1000
							: NaN;
					resolve({
						status: response.statusCode ?? 0,
						retryAfter: Number.isFinite(seconds)
							? Math.max(0, Math.min(seconds, 21600))
							: null,
					});
				});
			},
		);
		const timeout = setTimeout(
			() => req.destroy(new Error("delivery_timeout")),
			Math.max(1, 20000 - (Date.now() - started)),
		);
		req.on("close", () => clearTimeout(timeout));
		req.on("error", reject);
		req.end(body);
	});
}
