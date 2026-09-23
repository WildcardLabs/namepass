import assert from "node:assert/strict";
import test from "node:test";

import { HUB_CHAIN } from "../src/lib/chains";
import { ensNamehash, labelHash, readEnsState, readNativeUsdcBalanceSnapshots } from "./chain";

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
			| Array<{ id: number; data?: string; params: [{ data: string }, string] }>;
		if (!Array.isArray(body)) {
			return Response.json({ jsonrpc: "2.0", id: 0, result: body.method === "eth_chainId" ? "0xaa36a7" : "0x64" });
		}
		for (const request of body) assert.equal(request.params[1], "0x64");
		batch += 1;
		const word = (value: string | bigint) => BigInt(value).toString(16).padStart(64, "0");
		const helper = "0x1111111111111111111111111111111111111111";
		let results: string[];
		if (batch === 1) results = [helper, HUB_CHAIN.gatewayAddress!, HUB_CHAIN.pointerAddress!].map(word);
		else if (batch === 2) results = [1n, HUB_CHAIN.gatewayAddress!, HUB_CHAIN.factoryAddress!, HUB_CHAIN.usdcAddress].map(word);
		else if (batch === 3) results = [HUB_CHAIN.ensRegistrarAddress!, HUB_CHAIN.ensRenewerV1Address!, HUB_CHAIN.ensReferrer!].map(word);
		else {
			const encodedLabel = "20".padStart(64, "0") + "7".padStart(64, "0") + Buffer.from("vitalik").toString("hex").padEnd(64, "0");
			assert.equal(body[0].params[0].data.slice(10), encodedLabel);
			results = [word(1_800_000_000n) + word(HUB_CHAIN.ensRegistrarAddress!)];
		}
		return Response.json(body.map(({ id }) => ({ jsonrpc: "2.0", id, result: `0x${results[id]}` })));

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

test("ENS reads reject an incomplete RPC batch", async () => {
	const rpcVariable = "ETHEREUM_SEPOLIA_RPC_URL";
	const previousRpc = process.env[rpcVariable];
	const previousFetch = globalThis.fetch;
	process.env[rpcVariable] = "https://rpc.test";
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as { method: string } | Array<{ id: number }>;
		if (!Array.isArray(body)) {
			return Response.json({ jsonrpc: "2.0", id: 0, result: "0xaa36a7" });
		}
		return Response.json([{ jsonrpc: "2.0", id: body[0]!.id, result: `0x${"1".padStart(64, "0")}` }]);
	};
	try {
		await assert.rejects(() => readEnsState("vitalik"), /RPC response is incomplete/);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousRpc === undefined) delete process.env[rpcVariable];
		else process.env[rpcVariable] = previousRpc;
	}
});

test("balance snapshots pin the token read to the reported block", async () => {
	const rpcVariable = "BASE_SEPOLIA_RPC_URL";
	const previousRpc = process.env[rpcVariable];
	const previousFetch = globalThis.fetch;
	process.env[rpcVariable] = "https://snapshot-rpc.test";
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as
			| { method: string }
			| Array<{ id: number; params: [{ data: string }, string] }>;
		if (!Array.isArray(body)) {
			if (body.method === "eth_chainId") {
				return Response.json({ jsonrpc: "2.0", id: 0, result: "0x14a34" });
			}
			assert.equal(body.method, "eth_blockNumber");
			return Response.json({ jsonrpc: "2.0", id: 0, result: "0x64" });
		}
		assert.equal(body[0]?.params[1], "0x64");
		return Response.json([{ jsonrpc: "2.0", id: 0, result: `0x${"7a120".padStart(64, "0")}` }]);
	};
	try {
		assert.deepEqual(
			await readNativeUsdcBalanceSnapshots(
				"0x0000000000000000000000000000000000000001",
				[84532],
			),
			[{ chainId: 84532, amount: "500000", blockNumber: "100" }],
		);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousRpc === undefined) delete process.env[rpcVariable];
		else process.env[rpcVariable] = previousRpc;
	}
});
