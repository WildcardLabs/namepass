import {
	createHmac,
	randomBytes,
	timingSafeEqual,
	createCipheriv,
	createDecipheriv,
} from "node:crypto";
import { ACTIVE_ENVIRONMENT } from "../../src/lib/chains";
import { secret, DEPLOYMENT_ID } from "./config";
import { ApiError } from "../http";

export function equal(left: string, right: string): boolean {
	const a = Buffer.from(left),
		b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}
export function keyDigest(key: string): string {
	return createHmac("sha256", secret("INTEGRATION_KEY_PEPPER"))
		.update(`${DEPLOYMENT_ID}:${key}`)
		.digest("hex");
}
export function newCredential(): {
	key: string;
	prefix: string;
	digest: string;
} {
	const prefix = `np_${ACTIVE_ENVIRONMENT === "mainnet" ? "live" : "test"}_${randomBytes(8).toString("hex")}`;
	const key = `${prefix}_${randomBytes(32).toString("base64url")}`;
	return { key, prefix, digest: keyDigest(key) };
}
export function newSigningSecret(): string {
	return `whsec_${randomBytes(32).toString("base64")}`;
}
function encryptionKey(): Buffer {
	const raw = secret("INTEGRATION_ENCRYPTION_KEY");
	const key = Buffer.from(raw, "base64");
	if (key.length !== 32)
		throw new ApiError(
			503,
			"integration_configuration",
			"Webhook encryption is not configured.",
		);
	return key;
}
export function encrypt(value: string): string {
	const iv = randomBytes(12),
		cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
	return Buffer.concat([
		iv,
		cipher.update(value),
		cipher.final(),
		cipher.getAuthTag(),
	]).toString("base64");
}
export function decrypt(value: string): string {
	const data = Buffer.from(value, "base64");
	const cipher = createDecipheriv(
		"aes-256-gcm",
		encryptionKey(),
		data.subarray(0, 12),
	);
	cipher.setAuthTag(data.subarray(-16));
	return Buffer.concat([
		cipher.update(data.subarray(12, -16)),
		cipher.final(),
	]).toString();
}
export function webhookSignature(
	body: string,
	id: string,
	timestamp: number,
	signingSecret: string,
): string {
	return `v1,${createHmac(
		"sha256",
		Buffer.from(signingSecret.replace(/^whsec_/, ""), "base64"),
	)
		.update(`${id}.${timestamp}.${body}`)
		.digest("base64")}`;
}
export interface Cursor {
	partner: string;
	deployment: string;
	kind: string;
	position: string;
	asOf?: string;
	after?: string;
	filter?: string;
	snapshot?: string;
	expires: number;
}
export function encodeCursor(
	value: Omit<Cursor, "deployment" | "expires"> & { expires?: number },
): string {
	const body = Buffer.from(
		JSON.stringify({
			...value,
			deployment: DEPLOYMENT_ID,
			expires: value.expires ?? Date.now() + 90 * 86400000,
		}),
	).toString("base64url");
	return `${body}.${createHmac("sha256", secret("INTEGRATION_CURSOR_SECRET")).update(body).digest("base64url")}`;
}
export function decodeCursor(
	raw: string,
	partner: string,
	kind: string,
): Cursor {
	if (raw.length > 4096)
		throw new ApiError(400, "invalid_cursor", "The cursor is invalid.");
	const [body, signature, extra] = raw.split(".");
	const expected = createHmac("sha256", secret("INTEGRATION_CURSOR_SECRET"))
		.update(body ?? "")
		.digest("base64url");
	if (extra !== undefined || !signature || !equal(signature, expected))
		throw new ApiError(400, "invalid_cursor", "The cursor is invalid.");
	let value: Cursor;
	try {
		value = JSON.parse(Buffer.from(body, "base64url").toString());
	} catch {
		throw new ApiError(400, "invalid_cursor", "The cursor is invalid.");
	}
	if (
		!value ||
		value.partner !== partner ||
		value.deployment !== DEPLOYMENT_ID ||
		value.kind !== kind ||
		!/^\d+$/.test(value.position) ||
		!Number.isFinite(value.expires)
	) {
		throw new ApiError(
			400,
			"invalid_cursor",
			"The cursor belongs to a different query or deployment.",
		);
	}
	if (value.expires < Date.now())
		throw new ApiError(410, "cursor_expired", "Create a new sync snapshot.");
	return value;
}
