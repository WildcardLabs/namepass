import { writeFile, readFile, mkdir } from "node:fs/promises";
const text = { type: "string" },
	nullable = { type: ["string", "null"] },
	boolean = { type: "boolean" },
	integer = { type: "integer" },
	amount = {
		type: "string",
		pattern: "^(0|[1-9][0-9]*)$",
		description:
			"Exact integer in micro-USDC (six decimals), unless the field names another unit.",
	};
const uuid = { type: "string", format: "uuid" },
	date = { type: "string", format: "date-time" },
	hash = { type: "string", pattern: "^0x[0-9a-f]{64}$" },
	address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const nullableRef = (name) => ({ anyOf: [ref(name), { type: "null" }] });
const arr = (items) => ({ type: "array", items });
const obj = (
	properties,
	required = Object.keys(properties),
	extra = false,
) => ({ type: "object", properties, required, additionalProperties: extra });
const any = { type: "object", additionalProperties: true };
const base = {
	id: text,
	version: amount,
	resourceType: text,
	environment: { type: "string", enum: ["testnet", "mainnet"] },
	deploymentId: text,
};
const resource = (p) =>
	obj({ ...base, ...p }, [...Object.keys(base), ...Object.keys(p)], true);
const schemas = {
	Error: obj({
		error: obj({ code: text, message: text, details: any }, [
			"code",
			"message",
		]),
		requestId: text,
	}),
	Resource: resource({}),
	Name: resource({
		label: text,
		name: text,
		depositAddress: address,
		activatedAt: date,
		currentExpiry: nullable,
		renewableBy: nullable,
		ensSyncedAt: date,
		unscannedChainIds: arr(amount),
		lifetimeReceived: amount,
		lifetimeApplied: amount,
		timeDeliveredSeconds: amount,
		renewalCount: amount,
	}),
	Deposit: resource({
		nameId: uuid,
		chainId: amount,
		tokenAddress: address,
		senderAddress: address,
		amount,
		txHash: hash,
		transferKind: { type: "string", enum: ["erc20", "native"] },
		logIndex: { type: ["integer", "null"] },
		blockNumber: amount,
		blockTime: date,
		observationStatus: text,
	}),
	Flow: resource({
		nameId: uuid,
		originChainId: amount,
		executionStatus: text,
		status: text,
		trigger: text,
		holdReason: nullable,
		amountDetected: amount,
		amountProcessed: nullable,
		originWalletRemainder: nullable,
		executorAllowance: nullable,
		amountApplied: nullable,
		durationSeconds: nullable,
		expiryAfter: nullable,
		depositId: nullable,
		originEventId: nullable,
		renewalEventId: nullable,
		originTxHash: nullable,
		cctpNonce: nullable,
		reasonCode: nullable,
		nextActionAt: nullable,
		createdAt: date,
		settledAt: nullable,
	}),
	Amounts: obj({
		amountProcessed: amount,
		bridgeFee: amount,
		amountReceivedOnHub: amount,
		executorAllowance: amount,
		amountApplied: amount,
		roundingResidue: amount,
		originWalletRemainder: amount,
	}),
	Evidence: obj(
		{
			chainId: amount,
			txHash: hash,
			blockNumber: amount,
			blockHash: hash,
			transactionIndex: integer,
			logIndex: { type: ["integer", "null"] },
		},
		undefined,
		true,
	),
	Settlement: resource({
		flowId: uuid,
		nameId: uuid,
		status: { type: "string", enum: ["observed", "finalized", "invalidated"] },
		evidence: obj({ hub: ref("Evidence"), source: ref("Evidence"), ens: any }),
		amounts: ref("Amounts"),
		durationSeconds: amount,
		expiryAfter: nullable,
		observedAt: date,
		finalizedAt: nullable,
	}),
	Attempt: obj(
		{ txHash: hash, logIndex: { type: ["integer", "null"], minimum: 0 } },
		["txHash"],
	),
	Transfer: resource({
		nameId: uuid,
		reference: text,
		chainId: amount,
		transferKind: { type: "string", enum: ["erc20", "native"] },
		attempts: arr(ref("Attempt")),
		verification: any,
		depositId: nullable,
		status: {
			type: "string",
			enum: [
				"reported",
				"selection_required",
				"verified",
				"rejected",
				"orphaned",
				"completed",
			],
		},
		reasonCode: nullable,
		createdAt: date,
	}),
	Activation: resource({
		kind: text,
		nameId: { type: ["string", "null"], format: "uuid" },
		status: {
			type: "string",
			enum: ["pending", "running", "succeeded", "failed", "selection_required"],
		},
		result: { type: ["object", "null"], additionalProperties: true },
		reasonCode: nullable,
		createdAt: date,
	}),
	ActivationResult: obj({
		operationId: { type: ["string", "null"], format: "uuid" },
		nameId: uuid,
		name: text,
		depositAddress: address,
		alias: text,
		deploymentId: text,
		status: { type: "string", enum: ["ready", "initializing"] },
		snapshotRequired: boolean,
	}),
	Watch: obj({ name: text, nameId: uuid, createdAt: date }),
	WatchResult: obj({
		nameId: uuid,
		enabled: boolean,
		snapshotRequired: boolean,
	}),
	Endpoint: obj(
		{
			id: uuid,
			url: { type: "string", format: "uri" },
			status: { type: "string", enum: ["unverified", "active", "disabled"] },
			configurationVersion: integer,
			eventTypes: arr(text),
			signingSecret: text,
		},
		["id", "url", "status", "configurationVersion", "eventTypes"],
	),
	Delivery: obj(
		{
			id: uuid,
			endpointId: uuid,
			eventId: uuid,
			status: {
				type: "string",
				enum: ["pending", "running", "succeeded", "paused", "exhausted"],
			},
			attempts: integer,
			nextAttemptAt: date,
			reasonCode: nullable,
			createdAt: date,
			attemptHistory: arr(
				obj({
					attemptedAt: date,
					httpStatus: { type: ["integer", "null"] },
					durationMs: integer,
					reasonCode: nullable,
				}),
			),
		},
		[
			"id",
			"endpointId",
			"eventId",
			"status",
			"attempts",
			"nextAttemptAt",
			"reasonCode",
			"createdAt",
		],
	),
	Event: obj({
		id: uuid,
		type: text,
		apiVersion: text,
		environment: text,
		deploymentId: text,
		resourceType: text,
		resourceId: text,
		resourceVersion: amount,
		recordedAt: date,
		publishedAt: date,
		data: any,
	}),
	Snapshot: obj({
		id: uuid,
		expiresAt: date,
		eventsCursor: text,
		nextCursor: text,
	}),
	SnapshotPage: obj({
		items: arr(ref("Resource")),
		hasMore: boolean,
		nextCursor: nullable,
		eventsCursor: text,
	}),
	EventPage: obj({
		items: arr(ref("Event")),
		hasMore: boolean,
		nextCursor: text,
	}),
	Quote: obj({
		name: text,
		chainId: amount,
		deploymentId: text,
		amount,
		executorAllowance: amount,
		bridgeFee: amount,
		amountApplied: amount,
		roundingResidue: amount,
		durationSeconds: amount,
		helperAddress: address,
		blockNumber: amount,
		blockHash: hash,
		expiresAt: date,
		estimate: { const: true, type: "boolean" },
		assumptions: arr(text),
	}),
	Config: obj({
		apiVersion: text,
		environment: text,
		deploymentId: text,
		enabled: boolean,
		eventTypes: arr(text),
		eventRetentionDays: integer,
		snapshotLifetimeSeconds: integer,
		maxPageSize: integer,
		alias: obj({ suffix: text, resolutionChainId: amount, verified: boolean }),
		chains: arr(
			obj({
				chainId: amount,
				name: text,
				factoryAddress: address,
				token: obj({ address, symbol: text, decimals: integer }),
				fundingModes: arr({ type: "string", enum: ["erc20", "native"] }),
				nativeDecimals: { type: ["integer", "null"] },
				minimumTriggerAmount: amount,
				hubChainId: amount,
			}),
		),
	}),
};
schemas.Consumption = resource({
	status: {
		type: "string",
		enum: ["pending", "unresolved", "consumed", "completed"],
	},
	linkage: { enum: ["pooled", "unresolved"], type: "string" },
	flowIds: arr(uuid),
	reasonCode: nullable,
});
schemas.CoverageFields = obj({
	chainId: amount,
	fromBlock: amount,
	throughBlock: nullable,
	throughBlockHash: nullable,
	nativeFromBlock: nullable,
	nativeThroughBlock: nullable,
	nativeTargetBlock: nullable,
	status: text,
	checkedAt: date,
});
schemas.BalanceFields = obj({
	chainId: amount,
	snapshotAmount: amount,
	snapshotBlock: nullable,
	checkedAt: date,
});
schemas.DepositVerification = obj({
	...schemas.Evidence.properties,
	canonical: boolean,
	verifiedAt: date,
});
schemas.NameDetail = obj(
	{
		...schemas.Name.properties,
		alias: obj({
			name: text,
			suffix: text,
			resolutionChainId: amount,
			verified: boolean,
		}),
		historyCoverage: arr(ref("CoverageFields")),
		balances: arr(ref("BalanceFields")),
		fundingStatus: { type: "string", enum: ["ready", "initializing"] },
	},
	undefined,
	true,
);
schemas.DepositDetail = obj(
	{
		...schemas.Deposit.properties,
		requestedId: text,
		verification: nullableRef("DepositVerification"),
		consumption: nullableRef("Consumption"),
	},
	undefined,
	true,
);
schemas.FlowDetail = obj(
	{
		...schemas.Flow.properties,
		supersededBy: nullable,
		settlement: nullableRef("Settlement"),
	},
	undefined,
	true,
);
schemas.AttemptVerification = obj(
	{
		status: {
			type: "string",
			enum: ["verified", "pending", "rejected", "selection_required"],
		},
		depositId: text,
		reasonCode: text,
		candidates: arr(
			obj(
				{
					id: text,
					kind: { type: "string", enum: ["native", "erc20"] },
					logIndex: { type: ["integer", "null"] },
					amount,
					sender: address,
					aliasLogIndex: integer,
				},
				["id", "kind", "logIndex", "amount", "sender"],
			),
		),
	},
	["status"],
);
schemas.Transfer.properties.verification = {
	type: "object",
	additionalProperties: ref("AttemptVerification"),
};
for (const [schema, kind] of Object.entries({
	Name: "name",
	NameDetail: "name",
	Deposit: "deposit",
	DepositDetail: "deposit",
	Flow: "flow",
	FlowDetail: "flow",
	Settlement: "settlement",
	Transfer: "transfer",
	Activation: "activation",
	Consumption: "consumption",
}))
	schemas[schema].properties.resourceType = { const: kind, type: "string" };
for (const name of ["Deposit", "Flow", "Settlement", "Transfer"])
	schemas[name + "Page"] = obj({
		items: arr(ref(name)),
		asOf: date,
		hasMore: boolean,
		nextCursor: nullable,
	});
schemas.WatchPage = obj({
	items: arr(ref("Watch")),
	hasMore: boolean,
	nextCursor: nullable,
});
schemas.DeliveryPage = obj({
	items: arr(ref("Delivery")),
	hasMore: boolean,
	nextCursor: nullable,
});
const page = [
	{
		name: "limit",
		in: "query",
		schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
	},
	{ name: "cursor", in: "query", schema: text },
];
const filters = [
	"name",
	"chainId",
	"status",
	"txHash",
	"reference",
	"createdFrom",
	"updatedFrom",
].map((name) => ({ name, in: "query", schema: text }));
const paths = {};
function route(
	path,
	method,
	summary,
	response,
	scope = "read",
	body = null,
	idem = false,
	params = [],
) {
	const parameters = [
		...Array.from(path.matchAll(/\{([^}]+)\}/g), (m) => ({
			name: m[1],
			in: "path",
			required: true,
			schema: text,
		})),
		...params,
	];
	if (idem)
		parameters.push({
			name: "Idempotency-Key",
			in: "header",
			required: true,
			schema: {
				type: "string",
				minLength: 1,
				maxLength: 128,
				pattern: "^[A-Za-z0-9_.:-]+$",
			},
			description:
				"Reuse the same key and exact body on retries. Cached for seven days.",
		});
	const responses = {};
	for (const code of ["200", "201", "202"])
		responses[code] = {
			description:
				code === "202"
					? "Durably accepted; continue with the returned resource ID."
					: "Success.",
			content: {
				"application/json": {
					schema: typeof response === "string" ? ref(response) : response,
				},
			},
		};
	for (const code of [
		"400",
		"401",
		"403",
		"404",
		"409",
		"410",
		"413",
		"415",
		"422",
		"429",
		"500",
		"503",
	])
		responses[code] = {
			description:
				code === "410"
					? "Cursor expired; create a new snapshot."
					: code === "429"
						? "Rate limited. Honor Retry-After."
						: "Structured error.",
			content: { "application/json": { schema: ref("Error") } },
		};
	paths[path] ??= {};
	paths[path][method] = {
		operationId: method + path.replace(/[^a-zA-Z]/g, "_"),
		summary,
		description: `Required scope: \`${scope}\`.`,
		security: [{ bearerAuth: [] }],
		parameters,
		responses,
		...(body
			? {
					requestBody: {
						required: true,
						content: { "application/json": { schema: body } },
					},
				}
			: {}),
	};
}
route(
	"/config",
	"get",
	"Discover the active deployment and supported funding modes",
	"Config",
);
route(
	"/names/activate",
	"post",
	"Activate a name and create the caller’s watch",
	"ActivationResult",
	"names:write",
	obj({ name: text }),
	true,
);
route("/activations/{id}", "get", "Read a durable operation", "Activation");
route(
	"/names/{name}",
	"get",
	"Read stored name, alias verification, balance snapshots and history coverage",
	"NameDetail",
);
route(
	"/names/{name}/refresh",
	"post",
	"Refresh ENS and chain coverage asynchronously",
	"ActivationResult",
	"names:write",
	obj({}),
	true,
);
route(
	"/watches",
	"get",
	"List the caller’s enabled name watches",
	"WatchPage",
	"read",
	null,
	false,
	page,
);
for (const method of ["put", "delete"])
	route(
		"/watches/{name}",
		method,
		method === "put"
			? "Watch an activated name; bootstrap with /sync"
			: "Stop new notifications for a name",
		"WatchResult",
		"names:write",
		obj({}),
		true,
	);
route(
	"/quotes",
	"post",
	"Quote an exact input amount at a verified hub block",
	"Quote",
	"read",
	obj({ name: text, chainId: amount, amount }),
);
route(
	"/transfers",
	"post",
	"Register a transaction attempt with a private stable reference",
	obj({ transferId: uuid }),
	"transfers:write",
	obj(
		{
			name: text,
			chainId: amount,
			txHash: hash,
			reference: { ...text, minLength: 1, maxLength: 255 },
			transferKind: {
				type: "string",
				enum: ["erc20", "native"],
				default: "erc20",
			},
			logIndex: { type: ["integer", "null"], minimum: 0 },
		},
		["name", "chainId", "txHash", "reference"],
	),
	true,
);
route(
	"/transfers/{id}/transactions",
	"post",
	"Add a replacement hash or choose a receipt log",
	obj({ transferId: uuid }),
	"transfers:write",
	ref("Attempt"),
	true,
);
for (const [plural, resource] of [
	["transfers", "Transfer"],
	["deposits", "Deposit"],
	["flows", "Flow"],
	["settlements", "Settlement"],
]) {
	route(
		"/" + plural,
		"get",
		"List complete " + plural + " at a fixed publication position",
		resource + "Page",
		"read",
		null,
		false,
		[...page, ...filters],
	);
	route(
		"/" + plural + "/{id}",
		"get",
		"Read one " + resource.toLowerCase(),
		["Deposit", "Flow"].includes(resource) ? resource + "Detail" : resource,
	);
}
route(
	"/flows/{id}/retry",
	"post",
	"Revalidate and resume the same flow",
	obj({ flowId: uuid, operationId: uuid, status: text }, ["flowId"]),
	"flows:retry",
	obj({}),
	true,
);
route(
	"/sync",
	"post",
	"Create a consistent snapshot and matching event cursor",
	"Snapshot",
	"read",
	obj({}),
);
route(
	"/sync/{id}",
	"get",
	"Page an immutable snapshot for up to 24 hours",
	"SnapshotPage",
	"read",
	null,
	false,
	page,
);
route(
	"/events",
	"get",
	"Replay events; persist nextCursor only after durable processing",
	"EventPage",
	"read",
	null,
	false,
	[
		...page,
		{
			name: "from",
			in: "query",
			schema: date,
			description:
				"Inclusive publication timestamp for one-time bootstrap. Use cursor for every subsequent request.",
		},
	],
);
route(
	"/events/{id}",
	"get",
	"Read an event available to this partner",
	"Event",
);
route(
	"/webhook-endpoints",
	"get",
	"List webhook destinations",
	obj({ items: arr(ref("Endpoint")) }),
	"webhooks:manage",
);
route(
	"/webhook-endpoints",
	"post",
	"Register an unverified HTTPS webhook destination",
	"Endpoint",
	"webhooks:manage",
	obj({ url: { type: "string", format: "uri" }, eventTypes: arr(text) }, [
		"url",
	]),
	true,
);
route(
	"/webhook-endpoints/{id}",
	"get",
	"Read a webhook destination",
	"Endpoint",
	"webhooks:manage",
);
route(
	"/webhook-endpoints/{id}",
	"patch",
	"Edit destination or subscription; pending deliveries pause",
	"Endpoint",
	"webhooks:manage",
	obj(
		{
			url: { type: "string", format: "uri" },
			eventTypes: arr(text),
			enabled: boolean,
		},
		[],
	),
	true,
);
route(
	"/webhook-endpoints/{id}",
	"delete",
	"Disable a destination",
	"Endpoint",
	"webhooks:manage",
	obj({}),
	true,
);
for (const action of ["test", "verify"])
	route(
		"/webhook-endpoints/{id}/" + action,
		"post",
		action === "verify"
			? "Activate a destination after it accepts a signed verification event"
			: "Send a signed synthetic test event",
		obj({ deliveryId: uuid }),
		"webhooks:manage",
		obj({}),
		true,
	);
route(
	"/webhook-endpoints/{id}/rotate-secret",
	"post",
	"Rotate signing secret with a 24-hour overlap",
	obj({ id: uuid, signingSecret: text, previousSecretExpiresAt: date }),
	"webhooks:manage",
	obj({}),
	true,
);
route(
	"/webhook-deliveries",
	"get",
	"List delivery outcomes",
	"DeliveryPage",
	"webhooks:manage",
	null,
	false,
	page,
);
route(
	"/webhook-deliveries/{id}",
	"get",
	"Read a delivery and its recent attempts",
	"Delivery",
	"webhooks:manage",
);
route(
	"/webhook-deliveries/{id}/replay",
	"post",
	"Replay the immutable original event",
	obj({ deliveryId: uuid }),
	"webhooks:manage",
	obj({}),
	true,
);
const spec = {
	openapi: "3.1.0",
	info: {
		title: "Namepass Integration API",
		version: "2026-09-28",
		description:
			"USDC-funded ENS renewals. Testnet deployment. API enablement is controlled by the release gate. All monetary amounts are decimal integer strings. A flow execution status alone is not proof that a customer transfer completed; use verified consumption and finalized settlements.",
	},
	servers: [{ url: "/api/v1", description: "Current Namepass deployment" }],
	paths,
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "Server-side partner key with explicit scopes.",
			},
		},
		schemas,
	},
};
const content = JSON.stringify(spec, null, 2) + "\n";
const outputs = ["docs/api/openapi.json", "public/openapi.json"];
for (const output of outputs) {
	if (process.argv.includes("--check")) {
		if ((await readFile(output, "utf8")) !== content)
			throw new Error(output + " is stale.");
	} else {
		await mkdir(output.slice(0, output.lastIndexOf("/")), { recursive: true });
		await writeFile(output, content);
	}
}
