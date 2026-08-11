import assert from "node:assert/strict";
import test from "node:test";

import {
	activityCursor,
	activityPageInput,
	ApiError,
	handler,
	json,
	readObject,
	requiredString,
} from "./http";

test("handler returns structured errors and serializes bigint values", async () => {
	const route = handler("POST", async () => json({ amount: 1n }));
	const success = await route.fetch(new Request("https://namepass.test/api/example", { method: "POST" }));
	assert.equal(success.status, 200);
	assert.deepEqual(await success.json(), { amount: "1" });

	const method = await route.fetch(new Request("https://namepass.test/api/example", { method: "GET" }));
	assert.equal(method.status, 405);
	assert.equal(method.headers.get("allow"), "POST");
	assert.equal((await method.json()).error.code, "method_not_allowed");

	const invalid = handler("POST", async () => {
		throw new ApiError(400, "invalid_request", "The request is invalid.");
	});
	const response = await invalid.fetch(new Request("https://namepass.test/api/example", { method: "POST" }));
	assert.equal(response.status, 400);
	assert.equal((await response.json()).error.code, "invalid_request");
});

test("readObject rejects unknown fields", async () => {
	await assert.rejects(
		() =>
			readObject(
				new Request("https://namepass.test/api/example", {
					method: "POST",
					body: JSON.stringify({ name: "vitalik", unexpected: true }),
				}),
				["name"],
			),
		(error: unknown) => error instanceof ApiError && error.code === "invalid_request",
	);
});

test("activation input permits the .eth suffix before normalized byte validation", () => {
	const name = `${"a".repeat(255)}.eth`;
	assert.equal(requiredString({ name }, "name", 512), name);
});

test("activity cursors preserve both the timestamp and event ID", () => {
	const cursor = activityCursor({ blockTime: new Date("2026-08-11T12:00:00.000Z"), eventId: "event:42" });
	assert.deepEqual(
		activityPageInput(new Request(`https://namepass.test/api/activity?cursor=${cursor}`)).cursor,
		{ blockTime: new Date("2026-08-11T12:00:00.000Z"), eventId: "event:42" },
	);
	assert.throws(
		() =>
			activityPageInput(
				new Request(
					`https://namepass.test/api/activity?cursor=${btoa(JSON.stringify([Date.now(), "event", "extra"]))}`,
				),
			),
		(error: unknown) => error instanceof ApiError && error.code === "invalid_pagination",
	);
});
