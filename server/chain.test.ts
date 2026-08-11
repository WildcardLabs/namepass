import assert from "node:assert/strict";
import test from "node:test";

import { ensNamehash, labelHash, readEnsState } from "./chain";

test("ENS hashes match known vitalik vectors", () => {
	assert.equal(
		labelHash("vitalik"),
		"0xaf2caa1c2ca1d027f1ac823b529d0a67cd144264b2789fa2ea4d63a67c7103cc",
	);
	assert.equal(
		ensNamehash("vitalik"),
		"0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835",
	);
});

test("ENS reads verify the chain and ABI-encode the normalized label", async () => {
	const rpcVariable = "ETHEREUM_SEPOLIA_RPC_URL";
	const previousRpc = process.env[rpcVariable];
	const previousFetch = globalThis.fetch;
	process.env[rpcVariable] = "https://rpc.test";
	let batch = 0;

	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as
			| { method: string }
			| Array<{ id: number; data?: string; params: Array<{ data: string }> }>;
		if (!Array.isArray(body)) {
			assert.equal(body.method, "eth_chainId");
			return Response.json({ jsonrpc: "2.0", id: 0, result: "0xaa36a7" });
		}

		batch += 1;
		if (batch === 1) {
			const registry = "1234567890123456789012345678901234567890";
			const result = `0x${registry.padStart(64, "0")}`;
			return Response.json(body.map(({ id }) => ({ jsonrpc: "2.0", id, result })));
		}

		const encodedLabel =
			"20".padStart(64, "0") +
			"7".padStart(64, "0") +
			Buffer.from("vitalik").toString("hex").padEnd(64, "0");
		for (const request of body) {
			assert.equal(request.params[0].data.slice(10), encodedLabel);
		}
		const words = [1_800_000_000n, 1n, 0n].map(
			(value) => `0x${value.toString(16).padStart(64, "0")}`,
		);
		return Response.json(
			body.map(({ id }, index) => ({ jsonrpc: "2.0", id, result: words[index] })),
		);
	};

	try {
		assert.deepEqual(await readEnsState("vitalik"), {
			expiry: new Date(1_800_000_000_000),
			renewableBy: "registrar",
		});
	} finally {
		globalThis.fetch = previousFetch;
		if (previousRpc === undefined) delete process.env[rpcVariable];
		else process.env[rpcVariable] = previousRpc;
	}
});
