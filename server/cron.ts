import { timingSafeEqual } from "node:crypto";

import { ApiError } from "./http";

export function cronAuthorized(value: string | null, secret = process.env.CRON_SECRET): boolean {
	if (!secret || !value) return false;
	const left = Buffer.from(value);
	const right = Buffer.from(`Bearer ${secret}`);
	const size = Math.max(left.length, right.length, 1);
	const a = Buffer.alloc(size);
	const b = Buffer.alloc(size);
	left.copy(a);
	right.copy(b);
	return left.length === right.length && timingSafeEqual(a, b);
}

export function requireCronAuthorization(value: string | null): void {
	if (!cronAuthorized(value)) {
		throw new ApiError(401, "invalid_cron_auth", "The cron authorization is invalid.");
	}
}
