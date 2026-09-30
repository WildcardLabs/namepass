import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
	decodeAbiParameters,
	encodeAbiParameters,
	parseAbiParameters,
	toFunctionSelector,
} from "viem";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HUB_CHAIN, chainById } from "../../src/lib/chains";
import type { components } from "../../src/lib/integration-api.generated";
import quoteRoute from "../../routes/api/v1/quote";

// This boundary verifies live contract selection, exact RPC budgets and API results.
// The real ENS oracle/helper arithmetic is covered by test/Pricing.t.sol.
test(
	"anonymous quote uses the verified helper, pins reads, deducts fees and rejects unavailable pricing",
	{ timeout: 30000 },
	async () => {
		const source = chainById(84532)!;
		const previous = new Map(
			[HUB_CHAIN, source].map((c) => [c.rpcEnv, process.env[c.rpcEnv]]),
		);
		const enabled = process.env.NAMEPASS_INTEGRATIONS_ENABLED;
		const iris = process.env.CIRCLE_IRIS_URL;
		const originalFetch = globalThis.fetch;
		process.env.CIRCLE_IRIS_URL = "https://iris-api-sandbox.circle.com";
		process.env.NAMEPASS_INTEGRATIONS_ENABLED = "1";
		const code = await readFile(
			new URL("./fixtures/ens-v2-helper-runtime.hex", import.meta.url),
			"utf8",
		);
		const helper = "0x" + "12".repeat(20),
			minter = "0x" + "34".repeat(20);
		const word = (value: string) =>
			"0x" + value.replace(/^0x/, "").padStart(64, "0");
		let bridgeFee = 0n;
		let feesUnavailable = false;
		let feePayload: unknown;
		globalThis.fetch = (async (input, init) => {
			if (String(input).includes("/v2/burn/USDC/fees/")) {
				assert.equal(
					String(input),
					"https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/6/0",
				);
				return new Response(
					JSON.stringify(
						feePayload ?? [
							{ finalityThreshold: 1000, minimumFee: 1.3 },
							{ finalityThreshold: 2000, minimumFee: Number(bridgeFee) },
						],
					),
					{ status: feesUnavailable ? 503 : 200 },
				);
			}
			return originalFetch(input, init);
		}) as typeof fetch;
		let unsupported = false,
			renewable = true;
		const budgets: string[] = [];
		const replies = new Map<string, string>([
			[toFunctionSelector("currentHelper()"), word(helper)],
			[toFunctionSelector("gateway()"), word(HUB_CHAIN.gatewayAddress!)],
			[toFunctionSelector("pointer()"), word(HUB_CHAIN.pointerAddress!)],
			[toFunctionSelector("interfaceVersion()"), word("1")],
			[toFunctionSelector("factory()"), word(HUB_CHAIN.factoryAddress!)],
			[toFunctionSelector("paymentToken()"), word(HUB_CHAIN.usdcAddress)],
			[toFunctionSelector("GAS_ALLOWANCE()"), word((100000).toString(16))],
			[toFunctionSelector("localMinter()"), word(minter)],
			[
				toFunctionSelector("burnLimitsPerMessage(address)"),
				word((10000000).toString(16)),
			],
		]);
		const server = createServer(async (req, res) => {
			let raw = "";
			for await (const part of req) raw += part;
			const input = JSON.parse(raw);
			let result: unknown;
			if (input.method === "eth_chainId")
				result = "0x" + Number(req.url!.slice(1)).toString(16);
			else if (input.method === "eth_blockNumber") result = "0x14";
			else if (input.method === "eth_getBlockByNumber")
				result = {
					hash: "0x" + "14".repeat(32),
					number: "0x14",
					timestamp: "0x64",
					parentHash: "0x" + "00".repeat(32),
					transactions: [],
					gasLimit: "0x1000000",
					gasUsed: "0x5208",
					size: "0x100",
				};
			else if (input.method === "eth_getCode") {
				assert.equal(input.params[1], "0x14");
				result = unsupported ? "0x00" : code.trim();
			} else if (input.method === "eth_call") {
				assert.equal(
					input.params[1],
					"0x14",
					"Every pricing and route read must use its captured block.",
				);
				const selector = input.params[0].data.slice(0, 10);
				if (selector === toFunctionSelector("quote(string,uint256)")) {
					const [name, budget] = decodeAbiParameters(
						parseAbiParameters("string,uint256"),
						("0x" + input.params[0].data.slice(10)) as `0x${string}`,
					);
					assert.equal(name, "example");
					budgets.push(budget.toString());
					result = encodeAbiParameters(parseAbiParameters("uint64,uint256"), [
						12345n,
						890000n,
					]);
				} else if (selector === toFunctionSelector("renewableBy(string)"))
					result = renewable ? word(HUB_CHAIN.ensRegistrarAddress!) : word("0");
				else result = replies.get(selector);
			}
			res
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const local = server.address();
		assert.ok(local && typeof local !== "string");
		for (const c of [HUB_CHAIN, source])
			process.env[c.rpcEnv] = `http://127.0.0.1:${local.port}/${c.chainId}`;
		const request = (amount = "1000000", chainId = "84532") =>
			new Request("https://namepass.example/api/v1/quote", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "Example.eth", chainId, amount }),
			});
		try {
			const response = await quoteRoute.fetch(request());
			assert.equal(response.status, 200);
			const result = await response.json();
			const spec = JSON.parse(await readFile("docs/api/openapi.json", "utf8"));
			const validator = new Ajv2020({ strict: false });
			addFormats(validator);
			const contract = validator.compile<
				components["schemas"]["QuoteResponse"]
			>({
				$ref: "#/components/schemas/QuoteResponse",
				components: spec.components,
			});
			assert.ok(contract(result), JSON.stringify(contract.errors));
			assert.equal(result.name, "example.eth");
			assert.equal(result.secondsAdded, "12345");
			assert.equal(result.amountApplied, "890000");
			assert.equal(result.renewalFee, "100000");
			assert.equal(result.bridgeFee, "0");
			assert.equal(result.roundingRemainder, "10000");
			assert.equal(result.estimate, true);
			assert.equal(result.pricingBlock, "20");
			assert.equal("expiresAt" in result, false);
			assert.equal(response.headers.get("access-control-allow-origin"), "*");
			assert.equal(
				response.headers.get("access-control-expose-headers"),
				"Retry-After",
			);
			const results = await Promise.all([
				quoteRoute.fetch(request("1000000", String(HUB_CHAIN.chainId))),
				quoteRoute.fetch(request("2000000", String(HUB_CHAIN.chainId))),
			]);
			assert.ok(results.every((r) => r.status === 200));
			assert.deepEqual(budgets.sort(), ["1900000", "900000", "900000"].sort());
			assert.equal((await quoteRoute.fetch(request("100"))).status, 422);
			const excessive = await quoteRoute.fetch(request("10000001"));
			assert.equal(excessive.status, 422);
			assert.equal(
				(await excessive.json()).error.details.maximumAmount,
				"10000000",
			);
			assert.equal((await quoteRoute.fetch(request("1.5"))).status, 400);
			renewable = false;
			assert.equal((await quoteRoute.fetch(request())).status, 422);
			renewable = true;
			bridgeFee = 1n;
			assert.equal((await quoteRoute.fetch(request())).status, 503);
			bridgeFee = 0n;
			feesUnavailable = true;
			assert.equal((await quoteRoute.fetch(request())).status, 503);
			feesUnavailable = false;
			for (const payload of [
				[],
				{},
				[{ finalityThreshold: 1000, minimumFee: 0 }],
				[{ finalityThreshold: 2000, minimumFee: "0" }],
				[{ finalityThreshold: 2000, minimumFee: -1 }],
				[
					{ finalityThreshold: 2000, minimumFee: 0 },
					{ finalityThreshold: 2000, minimumFee: 0 },
				],
			]) {
				feePayload = payload;
				assert.equal((await quoteRoute.fetch(request())).status, 503);
			}
			feePayload = undefined;
			unsupported = true;
			const unavailable = await quoteRoute.fetch(request());
			assert.equal(unavailable.status, 503);
			assert.equal(
				(await unavailable.json()).error.code,
				"pricing_unavailable",
			);
		} finally {
			globalThis.fetch = originalFetch;
			if (iris === undefined) delete process.env.CIRCLE_IRIS_URL;
			else process.env.CIRCLE_IRIS_URL = iris;
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			if (enabled === undefined)
				delete process.env.NAMEPASS_INTEGRATIONS_ENABLED;
			else process.env.NAMEPASS_INTEGRATIONS_ENABLED = enabled;
			await new Promise<void>((resolve, reject) =>
				server.close((e) => (e ? reject(e) : resolve())),
			);
		}
	},
);
