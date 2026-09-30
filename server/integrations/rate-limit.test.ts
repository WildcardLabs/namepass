import assert from "node:assert/strict";
import test from "node:test";
import addressRoute from "../../routes/api/v1/address";
import quoteRoute from "../../routes/api/v1/quote";
import statusRoute from "../../routes/api/v1/status/[chainId]";

test("hosted API enforces SDK limits before work and preserves CORS, JSON and retry headers", async () => {
	const previous = new Map(
		[
			"VERCEL",
			"NODE_ENV",
			"NAMEPASS_INTEGRATIONS_ENABLED",
			"NAMEPASS_RATE_LIMIT_PREFIX",
		].map((key) => [key, process.env[key]]),
	);
	const originalFetch = globalThis.fetch;
	Object.assign(process.env, {
		VERCEL: "1",
		NODE_ENV: "production",
		NAMEPASS_INTEGRATIONS_ENABLED: "1",
		NAMEPASS_RATE_LIMIT_PREFIX: "integration-test",
	});
	let sdkStatus = 429;
	const ids: string[] = [];
	globalThis.fetch = (async (input, init) => {
		const url = new URL(String(input));
		assert.equal(url.origin, "https://beta.namepass.com");
		assert.ok(url.pathname.startsWith("/.well-known/vercel/rate-limit-api/"));
		const id = url.pathname.split("/").at(-1)!;
		assert.equal(new Headers(init?.headers).get("x-vercel-rate-limit-api"), id);
		ids.push(id);
		return new Response(null, { status: sdkStatus });
	}) as typeof fetch;
	const request = (path: string, method = "POST") =>
		new Request(`https://beta.namepass.com${path}`, {
			method,
			headers: {
				host: "beta.namepass.com",
				"x-real-ip": "203.0.113.7",
				"content-type": "application/json",
			},
			body: method === "POST" ? "{}" : undefined,
		});
	try {
		for (const [route, path, method] of [
			[addressRoute, "/api/v1/address", "POST"],
			[quoteRoute, "/api/v1/quote", "POST"],
			[statusRoute, "/api/v1/status/11155111", "GET"],
		] as const) {
			const response = await route.fetch(request(path, method));
			assert.equal(response.status, 429);
			assert.equal(response.headers.get("access-control-allow-origin"), "*");
			assert.equal(response.headers.get("retry-after"), "60");
			assert.equal((await response.json()).error.code, "rate_limited");
		}
		assert.deepEqual(ids, [
			"integration-test-address",
			"integration-test-quote",
			"integration-test-reads",
		]);
		assert.equal(
			(await addressRoute.fetch(request("/api/v1/address", "OPTIONS"))).status,
			204,
		);
		assert.equal(ids.length, 3, "Preflight must not consume a request bucket.");
		sdkStatus = 404;
		assert.equal(
			(await addressRoute.fetch(request("/api/v1/address"))).status,
			503,
			"A missing platform rule must fail closed.",
		);
		sdkStatus = 204;
		assert.equal(
			(await addressRoute.fetch(request("/api/v1/address"))).status,
			400,
			"An allowed request proceeds to input validation.",
		);
	} finally {
		globalThis.fetch = originalFetch;
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
