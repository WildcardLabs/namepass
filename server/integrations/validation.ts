import { ApiError } from "../http";
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
export function hash(value: unknown): string {
	const result = string(value, "transactionHash", 66).toLowerCase();
	if (!/^0x[\da-f]{64}$/.test(result)) invalid("transactionHash");
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
