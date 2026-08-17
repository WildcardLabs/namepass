import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import { pollIris } from "../workflows/iris";

const transactionHash = `0x${"11".repeat(32)}` as Hex;
const message = "0x0102" as Hex;
const request = {
	baseUrl: "https://iris-api-sandbox.circle.com",
	sourceDomain: 6,
	transactionHash,
	expectedMessage: message,
	attempt: 0,
	initialDelayMs: 5_000,
	maxDelayMs: 30_000,
};

test("Iris treats 404, incomplete, 429, and 5xx as retryable states", async () => {
	const responses = [
		new Response(null, { status: 404 }),
		Response.json({ messages: [{ message, status: "pending", cctpVersion: 2 }] }),
		new Response(null, { status: 429, headers: { "retry-after": "7" } }),
		new Response(null, { status: 503 }),
	];
	const reasons = ["not_found", "incomplete", "rate_limited", "server_error"];
	for (const [index, response] of responses.entries()) {
		const result = await pollIris(request, async () => response);
		assert.equal(result.kind, "pending");
		if (result.kind === "pending") {
			assert.equal(result.reason, reasons[index]);
			assert.ok(result.retryAfterMs >= 3_750 && result.retryAfterMs <= 30_000);
		}
	}
});

test("Iris accepts only the exact complete CCTP v2 message", async () => {
	const result = await pollIris(request, async () =>
		Response.json({
			messages: [
				{ message, attestation: "0xaabb", status: "complete", cctpVersion: 2 },
			],
		}),
	);
	assert.deepEqual(result, {
		kind: "complete",
		message,
		attestation: "0xaabb",
		status: "complete",
	});

	await assert.rejects(
		pollIris(request, async () =>
			Response.json({
				messages: [
					{ message: "0x0304", attestation: "0xaabb", status: "complete", cctpVersion: 2 },
				],
			}),
		),
		/no matching CCTP message/,
	);
});
