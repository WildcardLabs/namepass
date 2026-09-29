import { ApiError } from "../http";
import { normalizeLabel } from "../../src/lib/namepass";
import { chainById } from "../../src/lib/chains";

export function invalid(
	field: string,
	message = `${field} is invalid.`,
): never {
	throw new ApiError(400, "invalid_request", message, { field });
}
export function string(value: unknown, field: string, max = 255): string {
	if (typeof value !== "string" || !value.trim() || value.length > max)
		invalid(field);
	return value;
}
export function uuid(value: unknown, field = "id"): string {
	const result = string(value, field, 36);
	if (
		!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
			result,
		)
	)
		invalid(field);
	return result;
}
export function hash(value: unknown): string {
	const result = string(value, "txHash", 66).toLowerCase();
	if (!/^0x[\da-f]{64}$/.test(result)) invalid("txHash");
	return result;
}
export function unsigned(
	value: unknown,
	field: string,
	positive = false,
): string {
	const result = string(value, field, 78);
	if (
		!/^(0|[1-9]\d*)$/.test(result) ||
		BigInt(result) >= 2n ** 256n ||
		(positive && result === "0")
	)
		invalid(field);
	return result;
}
export function chain(value: unknown) {
	const id = unsigned(value, "chainId", true);
	const found = chainById(Number(id));
	if (!found)
		invalid("chainId", "This chain is not available in this deployment.");
	return found;
}
export function name(value: unknown): string {
	try {
		return normalizeLabel(string(value, "name", 512));
	} catch {
		return invalid("name");
	}
}
export function fields(
	object: Record<string, unknown>,
	allowed: string[],
): void {
	for (const key of Object.keys(object))
		if (!allowed.includes(key)) invalid(key, `Unknown field: ${key}.`);
}
export function time(value: string | null, field: string): string | null {
	if (value === null) return null;
	if (
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
		!Number.isFinite(Date.parse(value))
	)
		invalid(field);
	if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
		invalid(field);
	return new Date(value).toISOString();
}
export function pageSize(search: URLSearchParams): number {
	const raw = search.get("limit") ?? "50";
	if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100)
		invalid("limit");
	return Number(raw);
}
