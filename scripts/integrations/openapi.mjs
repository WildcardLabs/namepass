import { readFile, writeFile } from "node:fs/promises";
const text = { type: "string" },
	hash = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
	address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
	amount = {
		type: "string",
		pattern: "^(0|[1-9][0-9]*)$",
		description: "Exact integer encoded as a decimal string.",
	},
	status = {
		type: "string",
		enum: ["pending", "processing", "complete", "failed"],
	},
	nullable = { type: ["string", "null"] };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (items) => ({ type: "array", items });
const object = (properties) => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
});
const schemas = {
	Error: {
		type: "object",
		properties: {
			error: object({ code: text, message: text }),
			requestId: text,
		},
		required: ["error", "requestId"],
		additionalProperties: false,
	},
	FundingChain: object({
		chainId: amount,
		name: text,
		tokenAddress: address,
		minimumAmount: {
			...amount,
			description: "Minimum funding amount in six-decimal USDC units.",
		},
	}),
	AddressResponse: object({
		name: text,
		depositAddress: address,
		subname: text,
		subnameVerified: { type: "boolean" },
		chains: array(ref("FundingChain")),
	}),
	Renewal: object({
		chainId: amount,
		transactionHash: hash,
		secondsAdded: amount,
		expiry: { type: ["string", "null"], format: "date-time" },
	}),
	DepositStatus: object({
		name: text,
		depositAddress: address,
		logIndex: { type: ["integer", "null"] },
		amount: {
			...amount,
			description: "Deposited USDC, in six-decimal token units.",
		},
		status,
		reason: nullable,
		renewals: array(ref("Renewal")),
	}),
	StatusResponse: object({
		chainId: amount,
		transactionHash: hash,
		status,
		deposits: array(ref("DepositStatus")),
	}),
};
schemas.QuoteResponse = object({
	name: text,
	chainId: amount,
	amount,
	secondsAdded: amount,
	amountApplied: amount,
	renewalFee: amount,
	bridgeFee: amount,
	roundingRemainder: amount,
	pricingBlock: amount,
	expiresAt: { type: "string", format: "date-time" },
	estimate: { type: "boolean", const: true },
});
const optionalAmount = { ...amount, type: ["string", "null"] };
schemas.HistoryItem = object({
	flowId: { type: "string", format: "uuid" },
	sourceChainId: amount,
	chainId: amount,
	transactionHash: hash,
	secondsAdded: optionalAmount,
	amountApplied: optionalAmount,
	renewalFee: optionalAmount,
	expiry: { type: ["string", "null"], format: "date-time" },
	status: { type: "string", enum: ["processing", "complete"] },
	renewedAt: { type: "string", format: "date-time" },
});
schemas.HistoryResponse = object({
	name: text,
	currentExpiry: { type: ["string", "null"], format: "date-time" },
	expiryUpdatedAt: { type: ["string", "null"], format: "date-time" },
	items: array(ref("HistoryItem")),
	nextCursor: nullable,
});
// Error details are optional and identify invalid input fields.
schemas.Error.properties.error.properties.details = {
	type: "object",
	additionalProperties: true,
};
const response = (description, schema) => ({
	description,
	content: { "application/json": { schema: ref(schema) } },
	headers: {
		"Retry-After": {
			description:
				"Seconds to wait before polling again when pending or temporarily unavailable.",
			schema: { type: "string" },
		},
	},
});
const errors = {
	400: response(
		"Invalid name, chain ID, transaction hash or request.",
		"Error",
	),
	503: response(
		"Temporarily unavailable. Retry after the indicated delay.",
		"Error",
	),
	500: response("Server error.", "Error"),
};
const spec = {
	openapi: "3.1.0",
	info: {
		title: "Namepass public API",
		version: "2026-09-30",
		description:
			"Deposit addresses, renewal estimates, transaction status and ENS renewal history.",
	},
	servers: [{ url: "https://beta.namepass.com/api/v1" }],
	security: [],
	paths: {
		"/address": {
			post: {
				operationId: "post_address",
				summary: "Get a deposit address",
				description:
					"Activate deposit monitoring for an ENS name and return its deposit address, subname and supported funding chains.",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: object({ name: text }),
							example: { name: "example.eth" },
						},
					},
				},
				responses: {
					200: response(
						"Address activated and ready for funding.",
						"AddressResponse",
					),
					...errors,
				},
			},
		},
		"/status/{chainId}": {
			get: {
				operationId: "get_status",
				summary: "Poll a transaction",
				description:
					"Retrieve renewal status for a USDC deposit transaction. The transaction is complete when every indexed deposit has a verified, finalized renewal.",
				parameters: [
					{
						name: "chainId",
						in: "path",
						required: true,
						description:
							"Source EVM chain ID from the address response.",
						schema: amount,
					},
					{
						name: "transactionHash",
						in: "query",
						required: true,
						description:
							"The USDC deposit transaction hash returned by your wallet.",
						schema: hash,
					},
				],
				responses: {
					200: response(
						"Current progress. Poll pending or processing; stop at complete.",
						"StatusResponse",
					),
					404: response(
						"No matching deposit has been indexed. Retry the same URL.",
						"Error",
					),
					...errors,
				},
			},
		},
	},
	components: { schemas },
};
const validationError = response(
	"Name cannot currently renew, amount is below the minimum, or amount exceeds the single-flow quote limit.",
	"Error",
);
spec.paths["/address"].post.responses[422] = response(
	"The ENS name cannot currently be renewed.",
	"Error",
);
spec.paths["/quote"] = {
	post: {
		operationId: "post_quote",
		summary: "Estimate a renewal",
		description:
			"Estimate renewal duration and fees for an ENS name, funding chain and USDC amount. Quotes expire after 60 seconds and assume one processing flow with no existing balance at the deposit address.",
		requestBody: {
			required: true,
			content: {
				"application/json": {
					schema: object({ name: text, chainId: amount, amount }),
					example: { name: "example.eth", chainId: "84532", amount: "1000000" },
				},
			},
		},
		responses: {
			200: response(
				"Estimated renewal time and fee breakdown.",
				"QuoteResponse",
			),
			422: validationError,
			...errors,
		},
	},
};
spec.paths["/names/{name}/renewals"] = {
	get: {
		operationId: "get_name_renewals",
		summary: "List a name's renewals",
		description:
			"Retrieve public renewal history and the recorded expiry for an ENS name. Renewals are ordered newest first. Complete indicates a verified, finalized renewal; processing indicates pending verification.",
		parameters: [
			{
				name: "name",
				in: "path",
				required: true,
				description: "ENS name, such as example.eth.",
				schema: text,
			},
			{
				name: "limit",
				in: "query",
				description: "Items per page; defaults to 20.",
				schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
			},
			{
				name: "cursor",
				in: "query",
				description: "nextCursor from the previous page. Keep the same name.",
				schema: text,
			},
		],
		responses: {
			200: response("Name expiry and renewal history.", "HistoryResponse"),
			404: response(
				"This name has not been activated. Get its deposit address first.",
				"Error",
			),
			...errors,
		},
	},
};
const result = JSON.stringify(spec, null, 2) + "\n";
for (const file of ["docs/api/openapi.json", "public/openapi.json"]) {
	if (process.argv.includes("--check")) {
		if ((await readFile(file, "utf8")) !== result)
			throw new Error(`Stale API contract: ${file}`);
	} else await writeFile(file, result);
}
