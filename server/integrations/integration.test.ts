import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import {
	encodeEventTopics,
	encodeAbiParameters,
	parseAbiParameters,
} from "viem";
import { TRANSFER_ABI } from "./receipts";
import { chainById } from "../../src/lib/chains";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { publishBatch } from "./journal";
import { newCredential } from "./crypto";
import {
	receiptTransfers,
	selectTransfer,
	consumptionEvidence,
} from "./receipts";
import { endpointUrl, publicAddress } from "./webhook-network";
import {
	decodeCursor,
	encodeCursor,
	encrypt,
	decrypt,
	webhookSignature,
} from "./crypto";
// @ts-ignore The runnable receiver deliberately ships as dependency-light ESM.
import { verifyWebhook as verifyExampleWebhook } from "../../examples/integration/receiver.mjs";
import { createHmac } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const apiSpec = JSON.parse(await readFile("docs/api/openapi.json", "utf8"));
const validator = new Ajv2020({ strict: false });
addFormats(validator);
function assertContract(schema: string, value: unknown) {
	const validate = validator.compile({
		$ref: `#/components/schemas/${schema}`,
		components: apiSpec.components,
	});
	assert.ok(
		validate(JSON.parse(JSON.stringify(value))),
		JSON.stringify(validate.errors),
	);
}

process.env.INTEGRATION_KEY_PEPPER = "local-test-pepper-".repeat(3);
process.env.INTEGRATION_CURSOR_SECRET = "local-test-cursor-".repeat(3);
process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

test("signed cursors are scoped to a tenant, query, deployment and expiry", () => {
	const cursor = encodeCursor({
		partner: "bank-a",
		kind: "events",
		position: "9007199254740993",
	});
	assert.equal(
		decodeCursor(cursor, "bank-a", "events").position,
		"9007199254740993",
	);
	assert.throws(
		() => decodeCursor(cursor, "bank-b", "events"),
		/different query/,
	);
	assert.throws(
		() => decodeCursor(cursor + "x", "bank-a", "events"),
		/invalid/,
	);
	assert.throws(
		() =>
			decodeCursor(
				encodeCursor({
					partner: "a",
					kind: "events",
					position: "1",
					expires: 1,
				}),
				"a",
				"events",
			),
		/snapshot/,
	);
	const encrypted = encrypt("one-time credential");
	assert.equal(decrypt(encrypted), "one-time credential");
	const tampered = Buffer.from(encrypted, "base64");
	tampered[16] ^= 1;
	assert.throws(() => decrypt(tampered.toString("base64")));
});
test("webhook signature matches the Standard Webhooks wire format", () => {
	const key = Buffer.from("test-secret"),
		body = '{"type":"settlement.finalized"}';
	const expected = createHmac("sha256", key)
		.update("evt_1.1700000000." + body)
		.digest("base64");
	assert.equal(
		webhookSignature(
			body,
			"evt_1",
			1700000000,
			"whsec_" + key.toString("base64"),
		),
		"v1," + expected,
	);
});
test("webhooks reject local, mapped, transition, link-local and private destinations", () => {
	for (const ip of [
		"127.0.0.1",
		"10.2.3.4",
		"169.254.169.254",
		"172.31.4.5",
		"192.168.4.1",
		"100.64.0.1",
		"::1",
		"::ffff:8.8.8.8",
		"fe80::1",
		"fc00::1",
		"2002:7f00:1::",
		"2001:db8::1",
	])
		assert.equal(publicAddress(ip), false, ip);
	for (const ip of [
		"8.8.8.8",
		"1.1.1.1",
		"2606:4700:4700::1111",
		"2001:4860:4860::8888",
	])
		assert.equal(publicAddress(ip), true, ip);
	for (const url of [
		"http://bank.example/hook",
		"https://user:pass@bank.example/",
		"https://127.0.0.1/",
		"https://bank.example:8443/",
		"https://bank.example/#a",
	])
		assert.throws(() => endpointUrl(url));
});
test("consumption requires every candidate slice to settle, and never allocates time", () => {
	const deposit = { blockNumber: "10", transactionIndex: 2, logIndex: 1 };
	const slices = [
		{
			blockNumber: "11",
			transactionIndex: 0,
			logIndex: 3,
			flowId: "a",
			remaining: "4000000",
			finalized: true,
		},
		{
			blockNumber: "12",
			transactionIndex: 0,
			logIndex: 3,
			flowId: "b",
			remaining: "0",
			finalized: false,
		},
	];
	assert.equal(consumptionEvidence(deposit, slices, true).status, "consumed");
	assert.equal(
		consumptionEvidence(deposit, slices, false).status,
		"unresolved",
	);
	assert.equal(
		consumptionEvidence(
			deposit,
			slices.map((s) => ({ ...s, finalized: true })),
			true,
		).status,
		"completed",
	);
	assert.deepEqual(consumptionEvidence(deposit, slices, true).flowIds, [
		"a",
		"b",
	]);
	assert.equal(
		consumptionEvidence(deposit, slices, true).allocationAmounts,
		null,
	);
	assert.equal(
		consumptionEvidence({ ...deposit, blockNumber: "13" }, slices, true).status,
		"pending",
	);
	assert.equal(
		consumptionEvidence(deposit, [{ ...slices[1], flowId: null }], true).status,
		"unresolved",
	);
});
test("ambiguous receipt logs require explicit selection", () => {
	const candidates = [
		{
			id: "a",
			kind: "erc20" as const,
			logIndex: 1,
			amount: "3000000",
			sender: "a",
		},
		{
			id: "b",
			kind: "erc20" as const,
			logIndex: 2,
			amount: "7000000",
			sender: "a",
		},
	];
	assert.throws(() => selectTransfer(candidates, "erc20", null), /Choose one/);
	assert.equal(selectTransfer(candidates, "erc20", 2).id, "b");
	assert.throws(() => selectTransfer(candidates, "erc20", 3), /No supported/);
	assert.throws(
		() =>
			receiptTransfers(
				{ chainId: 1, key: "ethereum", usdcAddress: "0x0" },
				"0x1",
				{ status: "reverted" } as never,
				{} as never,
			),
		/reverted/,
	);
});

test(
	"real PostgreSQL: commit-order publication, snapshots, tenant isolation and durable commands",
	{ skip: !process.env.TEST_DATABASE_URL, timeout: 120000 },
	async (t) => {
		const url = new URL(process.env.TEST_DATABASE_URL!);
		assert.ok(
			["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
			"Tests require a disposable loopback PostgreSQL server.",
		);
		const admin = new Pool({ connectionString: url.toString() });
		const name = `namepass_integrations_test_${process.pid}_${Date.now()}`;
		await admin.query(`create database "${name}"`);
		url.pathname = "/" + name;
		process.env.DATABASE_URL = url.toString();
		const pool = new Pool({ connectionString: url.toString(), max: 8 });
		const db = drizzle(pool);
		try {
			for (const file of (await readdir("drizzle"))
				.filter((f) => f.endsWith(".sql"))
				.sort())
				await pool.query(await readFile("drizzle/" + file, "utf8"));
			const [{ id: a }, { id: b }] = (
				await pool.query(
					"insert into integration_partners(name) values('bank-a'),('bank-b') returning id",
				)
			).rows;
			const [{ id: n }] = (
				await pool.query(
					"insert into names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at) values('alice','alice.eth',$1,$2,$3,now()) returning id",
					[
						"0x" + "11".repeat(32),
						"0x" + "22".repeat(32),
						"0x" + "33".repeat(20),
					],
				)
			).rows;
			await pool.query(
				"insert into integration_watches(partner_id,name_id) values($1,$3),($2,$3)",
				[a, b, n],
			);
			await db.transaction((tx) => publishBatch(tx as never));
			const first = await pool.connect(),
				second = await pool.connect();
			try {
				await first.query("begin");
				await first.query(
					"insert into integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type) values('probe','early',1,$1,'{}','probe.updated')",
					[n],
				);
				await second.query("begin");
				await second.query(
					"insert into integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type) values('probe','late',1,$1,'{}','probe.updated')",
					[n],
				);
				await second.query("commit");
				assert.equal(
					await db.transaction((tx) => publishBatch(tx as never)),
					1,
				);
				const published = (
					await pool.query(
						"select position from integration_events where resource_id='late'",
					)
				).rows[0].position;
				await first.query("commit");
				assert.equal(
					await db.transaction((tx) => publishBatch(tx as never)),
					1,
				);
				const early = (
					await pool.query(
						"select position from integration_events where resource_id='early'",
					)
				).rows[0].position;
				assert.ok(
					BigInt(early) > BigInt(published),
					"An earlier sequence ID committed later must remain replayable.",
				);
			} finally {
				first.release();
				second.release();
			}
			await t.test(
				"publisher rollback never advances the public cursor",
				async () => {
					await pool.query(
						"insert into integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type) values('probe','rollback',1,$1,'{}','probe.updated')",
						[n],
					);
					const before = (
						await pool.query("select position from integration_publication")
					).rows[0].position;
					await assert.rejects(
						db.transaction(async (tx) => {
							await publishBatch(tx as never);
							throw new Error("crash");
						}),
						/crash/,
					);
					assert.equal(
						(await pool.query("select position from integration_publication"))
							.rows[0].position,
						before,
					);
					await Promise.all([
						db.transaction((tx) => publishBatch(tx as never)),
						db.transaction((tx) => publishBatch(tx as never)),
					]);
					assert.equal(
						(
							await pool.query(
								"select count(*)::int as n from integration_events where resource_id='rollback'",
							)
						).rows[0].n,
						1,
					);
				},
			);
			await t.test(
				"snapshot stays fixed while later changes remain in the event feed",
				async () => {
					const { createSnapshot, snapshotPage, listEvents } =
						await import("./reads");
					const snap = await createSnapshot(a);
					await pool.query(
						"update names set display_name='alice.eth updated' where id=$1",
						[n],
					);
					await db.transaction((tx) => publishBatch(tx as never));
					const page = await snapshotPage(
						a,
						snap.id,
						new URLSearchParams({ cursor: snap.nextCursor }),
					);
					assertContract("Snapshot", snap);
					assertContract("SnapshotPage", page);
					for (const item of page.items)
						if (item.resourceType === "name") assertContract("Name", item);
					assert.equal(page.items.find((i) => i.id === n)?.name, "alice.eth");
					const changes = await listEvents(
						a,
						new URLSearchParams({ cursor: snap.eventsCursor }),
					);
					assertContract("EventPage", changes);
					assert.equal(
						changes.items.filter((i) => i.resourceId === n).length,
						1,
					);
				},
			);
			await t.test(
				"scoped auth, private references, idempotency conflicts and duplicate writes",
				async () => {
					const ca = newCredential(),
						cb = newCredential();
					await pool.query(
						"insert into integration_keys(partner_id,prefix,digest,scopes) values($1,$2,$3,$7),($4,$5,$6,$7)",
						[
							a,
							ca.prefix,
							ca.digest,
							b,
							cb.prefix,
							cb.digest,
							["read", "transfers:write"],
						],
					);
					const { integrationRoute } = await import("./http");
					const { reportTransfer } = await import("./commands");
					const route = integrationRoute({
						POST: {
							scope: "transfers:write",
							idempotent: true,
							run: reportTransfer,
						},
					});
					process.env.NAMEPASS_INTEGRATIONS_ENABLED = "1";
					const body = JSON.stringify({
						name: "alice.eth",
						chainId: "84532",
						txHash: "0x" + "ab".repeat(32),
						reference: "bank-ref-1",
					});
					const req = (key: string, raw = body) =>
						new Request("https://api.example/api/v1/transfers", {
							method: "POST",
							headers: {
								authorization: "Bearer " + ca.key,
								"content-type": "application/json",
								"idempotency-key": key,
							},
							body: raw,
						});
					const results = await Promise.all([
						route.fetch(req("same")),
						route.fetch(req("same")),
					]);
					assert.deepEqual(
						results.map((r) => r.status),
						[202, 202],
					);
					const one = await results[0].json(),
						two = await results[1].json();
					assert.equal(one.transferId, two.transferId);
					assert.equal(
						(
							await route.fetch(
								req("same", body.replace("bank-ref-1", "bank-ref-2")),
							)
						).status,
						409,
					);
					assert.equal((await route.fetch(req("different"))).status, 200);
					await db.transaction((tx) => publishBatch(tx as never));
					const { getResource } = await import("./reads");
					await assert.rejects(
						getResource(b, "transfer", one.transferId),
						/not available/,
					);
					const found = await getResource(a, "transfer", one.transferId);
					assert.equal(found.reference, "bank-ref-1");
					assertContract("Transfer", found);
					assert.equal(
						(
							await pool.query(
								"select count(*)::int as n from integration_transfers",
							)
						).rows[0].n,
						1,
					);
					await pool.query(
						"update integration_keys set revoked_at=now() where digest=$1",
						[ca.digest],
					);
					assert.equal((await route.fetch(req("revoked"))).status, 401);
					process.env.NAMEPASS_INTEGRATIONS_ENABLED = "0";
				},
			);
			await t.test(
				"expensive reads also respect the write budget and scoped keys cannot activate names",
				async () => {
					const credential = newCredential();
					await pool.query(
						"insert into integration_keys(partner_id,prefix,digest,scopes) values($1,$2,$3,$4)",
						[b, credential.prefix, credential.digest, ["read"]],
					);
					process.env.NAMEPASS_INTEGRATIONS_ENABLED = "1";
					try {
						const activateRoute = (
							await import("../../routes/api/v1/names/activate")
						).default;
						const quoted = (await import("../../routes/api/v1/quotes")).default;
						const req = (path: string) =>
							new Request("https://api.example/api/v1/" + path, {
								method: "POST",
								headers: {
									authorization: "Bearer " + credential.key,
									"content-type": "application/json",
									"idempotency-key": "quota-fixture",
								},
								body: JSON.stringify({
									name: "alice.eth",
									chainId: "84532",
									amount: "1000000",
								}),
							});
						assert.equal(
							(await activateRoute.fetch(req("names/activate"))).status,
							403,
						);
						await pool.query(
							"insert into integration_quotas(partner_id,bucket,tokens) values($1,'write',0) on conflict(partner_id,bucket) do update set tokens=0,updated_at=clock_timestamp()",
							[b],
						);
						const limited = await quoted.fetch(req("quotes"));
						assert.equal(limited.status, 429);
						assert.ok(Number(limited.headers.get("retry-after")) > 0);
						const { nameResource } = await import("./resources");
						assertContract("NameDetail", await nameResource(b, "alice.eth"));
					} finally {
						process.env.NAMEPASS_INTEGRATIONS_ENABLED = "0";
					}
				},
			);

			await t.test(
				"webhook retries preserve event identity and body; endpoint edits fence old work",
				async () => {
					const { createEndpoint, testEndpoint, deliverOne, editEndpoint } =
						await import("./webhooks");
					const verifyWebhook = verifyExampleWebhook;
					const { database } = await import("../db/client");
					const context = {
						request: new Request("https://api.example"),
						partner: {
							id: a,
							keyId: "test",
							scopes: ["read" as const],
							readRate: 10,
							writeRate: 60,
						},
						body: { url: "https://bank.example/namepass" },
						search: new URLSearchParams(),
						db: database(),
					};
					const result = await db.transaction((tx) =>
						createEndpoint({ ...context, db: tx as never }),
					);
					const ep = result.body;
					await testEndpoint({ ...context, body: {} }, ep.id, true);
					const bodies: string[] = [],
						ids: string[] = [];
					await deliverOne(async (_url, body, headers) => {
						verifyWebhook(Buffer.from(body), headers, [ep.signingSecret]);
						bodies.push(body);
						ids.push(headers["webhook-id"]);
						return { status: 503, retryAfter: null };
					});
					await pool.query(
						"update integration_deliveries set next_at=now()-interval '1 second'",
					);
					await deliverOne(async (_url, body, headers) => {
						verifyWebhook(Buffer.from(body), headers, [ep.signingSecret]);
						bodies.push(body);
						ids.push(headers["webhook-id"]);
						return { status: 204, retryAfter: null };
					});
					assert.equal(ids[0], ids[1]);
					assert.equal(bodies[0], bodies[1]);
					assert.equal(
						(
							await pool.query(
								"select status from integration_endpoints where id=$1",
								[ep.id],
							)
						).rows[0].status,
						"active",
					);
					const [delivery] = (
						await pool.query(
							"select status,attempts from integration_deliveries where endpoint_id=$1",
							[ep.id],
						)
					).rows;
					assert.equal(delivery.status, "succeeded");
					assert.equal(delivery.attempts, 2);
					await testEndpoint({ ...context, body: {} }, ep.id, false);
					await db.transaction((tx) =>
						editEndpoint(
							{
								...context,
								body: { url: "https://new-bank.example/namepass" },
								db: tx as never,
							},
							ep.id,
						),
					);
					let sent = false;
					await deliverOne(async () => {
						sent = true;
						return { status: 200, retryAfter: null };
					});
					assert.equal(sent, false);
				},
			);
			await t.test(
				"receipt registration and late indexer delivery share one transfer identity",
				async () => {
					const wallet = "0x" + "66".repeat(20),
						sender = "0x" + "77".repeat(20),
						hash = "0x" + "88".repeat(32),
						blockHash = "0x" + "99".repeat(32);
					const chain = chainById(84532)!;
					const n2 = (
						await pool.query(
							"insert into names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at) values('receipt','receipt.eth',$1,$2,$3,now()) returning id",
							["0x" + "55".repeat(32), "0x" + "66".repeat(32), wallet],
						)
					).rows[0].id;
					await pool.query(
						"insert into integration_watches(partner_id,name_id) values($1,$2)",
						[a, n2],
					);
					const log = {
						address: chain.usdcAddress,
						topics: encodeEventTopics({
							abi: TRANSFER_ABI,
							eventName: "Transfer",
							args: {
								from: sender as `0x${string}`,
								to: wallet as `0x${string}`,
							},
						}),
						data: encodeAbiParameters(parseAbiParameters("uint256"), [100000n]),
						blockNumber: "0xa",
						transactionHash: hash,
						transactionIndex: "0x0",
						blockHash,
						logIndex: "0x5",
						removed: false,
					};
					const receipt = {
						transactionHash: hash,
						transactionIndex: "0x0",
						blockHash,
						blockNumber: "0xa",
						from: sender,
						to: chain.usdcAddress,
						cumulativeGasUsed: "0x5208",
						gasUsed: "0x5208",
						effectiveGasPrice: "0x1",
						contractAddress: null,
						logs: [log],
						logsBloom: "0x" + "00".repeat(256),
						status: "0x1",
						type: "0x2",
					};
					const tx = {
						hash,
						from: sender,
						to: chain.usdcAddress,
						nonce: "0x1",
						gas: "0x5208",
						gasPrice: "0x1",
						value: "0x0",
						input: "0x",
						blockHash,
						blockNumber: "0xa",
						transactionIndex: "0x0",
						type: "0x2",
						chainId: "0x14a34",
						v: "0x0",
						r: "0x1",
						s: "0x1",
					};
					let receiptPresent = true,
						transactionPresent = true;
					const server = createServer(async (req, res) => {
						let raw = "";
						for await (const part of req) raw += part;
						const input = JSON.parse(raw);
						const result =
							input.method === "eth_chainId"
								? "0x14a34"
								: input.method === "eth_getTransactionReceipt"
									? receiptPresent
										? receipt
										: null
									: input.method === "eth_getTransactionByHash"
										? tx
										: input.method === "eth_getBlockByNumber"
											? {
													hash: blockHash,
													number: "0xa",
													timestamp: "0x64",
													parentHash: "0x" + "00".repeat(32),
													transactions: transactionPresent ? [hash] : [],
													gasLimit: "0x1000000",
													gasUsed: "0x5208",
													size: "0x100",
												}
											: null;
						res
							.writeHead(200, { "content-type": "application/json" })
							.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
					});
					await new Promise<void>((resolve) =>
						server.listen(0, "127.0.0.1", resolve),
					);
					const old = process.env[chain.rpcEnv];
					const address = server.address();
					assert.ok(address && typeof address !== "string");
					process.env[chain.rpcEnv] = `http://127.0.0.1:${address.port}`;
					try {
						const { database } = await import("../db/client");
						const { reportTransfer } = await import("./commands");
						const {
							verifyTransfer,
							canonicalReceipt,
							storeEvidence,
							verifyDeposit,
						} = await import("./evidence");
						const reported = await database().transaction((tx) =>
							reportTransfer({
								request: new Request("https://api.example"),
								partner: {
									id: a,
									keyId: "test",
									scopes: ["read", "transfers:write"],
									readRate: 10,
									writeRate: 60,
								},
								body: {
									name: "receipt.eth",
									chainId: "84532",
									txHash: hash,
									reference: "receipt-fixture",
								},
								search: new URLSearchParams(),
								db: tx,
							}),
						);
						await verifyTransfer(reported.body.transferId);
						const transfer = (
							await pool.query(
								"select status,deposit_id from integration_transfers where id=$1",
								[reported.body.transferId],
							)
						).rows[0];
						assert.equal(transfer.status, "verified");
						assert.equal(transfer.deposit_id, `84532:log_${hash}_5`);
						const { ingestGoldskyEvent, postgresGoldskyStore } =
							await import("../goldsky");
						const event = {
							eventId: "84532:provider-specific-id",
							eventFamily: "deposit" as const,
							eventType: "Transfer",
							chainId: 84532,
							blockNumber: "10",
							blockTime: new Date(100000),
							txHash: hash,
							logIndex: 5,
							gsOp: "c" as const,
							transferKind: "erc20" as const,
							tokenAddress: chain.usdcAddress.toLowerCase(),
							senderAddress: sender,
							recipientAddress: wallet,
							amount: "100000",
							facts: {},
							payload: {},
						};
						await ingestGoldskyEvent(postgresGoldskyStore, event);
						assert.equal(event.eventId, transfer.deposit_id);
						assert.equal(
							(
								await pool.query(
									"select count(*)::int as n from deposits where name_id=$1",
									[n2],
								)
							).rows[0].n,
							1,
						);
						const validReceipt = (await canonicalReceipt(chain.chainId, hash))
							.receipt;
						const { normalizeIndexedDeposit } = await import("./coverage");
						const deletion = { ...event, gsOp: "d" as const };
						await normalizeIndexedDeposit(deletion);
						assert.equal(
							deletion.gsOp,
							"c",
							"A reminted receipt wins over a late deletion.",
						);
						receiptPresent = false;
						await assert.rejects(
							normalizeIndexedDeposit({ ...event, gsOp: "d" }),
							"A temporarily missing receipt cannot orphan a transaction still in its canonical block.",
						);
						transactionPresent = false;
						const removed = { ...event, gsOp: "d" as const };
						await normalizeIndexedDeposit(removed);
						await ingestGoldskyEvent(postgresGoldskyStore, removed);
						assert.equal(
							(
								await pool.query(
									"select canonical from integration_evidence where id=$1",
									[transfer.deposit_id],
								)
							).rows[0].canonical,
							false,
						);
						await assert.rejects(
							storeEvidence(
								transfer.deposit_id,
								chain.chainId,
								validReceipt,
								5,
								"erc20",
							),
							/current source identity/,
						);
						receiptPresent = true;
						transactionPresent = true;
						await verifyDeposit(transfer.deposit_id);
						assert.equal(
							(
								await pool.query(
									"select status from deposits where event_id=$1",
									[transfer.deposit_id],
								)
							).rows[0].status,
							"detected",
						);
						assert.equal(
							(
								await pool.query(
									"select canonical from integration_evidence where id=$1",
									[transfer.deposit_id],
								)
							).rows[0].canonical,
							true,
						);
						await db.transaction((tx) => publishBatch(tx as never));
						const { depositResource } = await import("./resources");
						assertContract(
							"DepositDetail",
							await depositResource(a, transfer.deposit_id),
						);
					} finally {
						if (old === undefined) delete process.env[chain.rpcEnv];
						else process.env[chain.rpcEnv] = old;
						await new Promise<void>((resolve, reject) =>
							server.close((e) => (e ? reject(e) : resolve())),
						);
					}
				},
			);
			await t.test(
				"exact ENS receipt drives observed, finalized and invalidated settlement",
				async () => {
					const { HUB_CHAIN } = await import("../../src/lib/chains");
					const { labelHash } = await import("../chain");
					const { verifyFlow } = await import("./evidence");
					const { RENEWED_ABI, PROCESSED_ABI } = await import("./receipts");
					const { parseAbi, toFunctionSelector } = await import("viem");
					const chain = HUB_CHAIN,
						wallet = ("0x" + "33".repeat(20)) as `0x${string}`,
						helper = ("0x" + "12".repeat(20)) as `0x${string}`;
					const hash = ("0x" + "13".repeat(32)) as `0x${string}`,
						blockHash = "0x" + "14".repeat(32),
						key = labelHash("alice") as `0x${string}`;
					const helperAbi = parseAbi([
						"event HelperUsed(address indexed helper,bytes32 indexed labelHash,address indexed wallet)",
					]);
					const ensAbi = parseAbi([
						"event NameRenewed(uint256 indexed tokenId,string label,uint64 duration,uint64 newExpiry,address paymentToken,bytes32 indexed referrer,uint256 amount)",
					]);
					const log = (
						address: string,
						topics: unknown,
						data: string,
						index: number,
					) => ({
						address,
						topics,
						data,
						logIndex: "0x" + index.toString(16),
						transactionIndex: "0x0",
						transactionHash: hash,
						blockHash,
						blockNumber: "0x14",
						removed: false,
					});
					const ensData = (amount: bigint) =>
						encodeAbiParameters(
							parseAbiParameters("string,uint64,uint64,address,uint256"),
							[
								"alice",
								100n,
								2000000000n,
								chain.usdcAddress as `0x${string}`,
								amount,
							],
						);
					const logs = [
						log(
							chain.gatewayAddress!,
							encodeEventTopics({
								abi: helperAbi,
								eventName: "HelperUsed",
								args: { helper, labelHash: key, wallet },
							}),
							"0x",
							0,
						),
						log(
							chain.ensRegistrarAddress!,
							encodeEventTopics({
								abi: ensAbi,
								eventName: "NameRenewed",
								args: {
									tokenId: 1n,
									referrer: chain.ensReferrer as `0x${string}`,
								},
							}),
							ensData(900000n),
							1,
						),
						log(
							chain.gatewayAddress!,
							encodeEventTopics({
								abi: RENEWED_ABI,
								eventName: "Renewed",
								args: { labelHash: key, wallet, executor: helper },
							}),
							encodeAbiParameters(
								parseAbiParameters(
									"string,uint64,uint256,uint256,uint256,uint256,bool",
								),
								["alice", 100n, 1000000n, 100000n, 900000n, 0n, false],
							),
							2,
						),
						log(
							chain.factoryAddress!,
							encodeEventTopics({
								abi: PROCESSED_ABI,
								eventName: "DepositProcessed",
								args: { labelKey: key, wallet },
							}),
							encodeAbiParameters(parseAbiParameters("uint256,uint256"), [
								1000000n,
								0n,
							]),
							3,
						),
					];
					const receipt = {
						transactionHash: hash,
						transactionIndex: "0x0",
						blockHash,
						blockNumber: "0x14",
						from: helper,
						to: chain.factoryAddress,
						cumulativeGasUsed: "0x5208",
						gasUsed: "0x5208",
						effectiveGasPrice: "0x1",
						contractAddress: null,
						logs,
						logsBloom: "0x" + "00".repeat(256),
						status: "0x1",
						type: "0x2",
					};
					let final = false;
					const server = createServer(async (req, res) => {
						let raw = "";
						for await (const part of req) raw += part;
						const input = JSON.parse(raw);
						let result: unknown;
						if (input.method === "eth_chainId")
							result = "0x" + chain.chainId.toString(16);
						else if (input.method === "eth_getTransactionReceipt")
							result = receipt;
						else if (input.method === "eth_getBlockByNumber")
							result = {
								hash: blockHash,
								number:
									input.params[0] === "finalized" && !final ? "0x13" : "0x14",
								timestamp: "0x64",
								parentHash: "0x" + "00".repeat(32),
								transactions: [hash],
								gasLimit: "0x1000000",
								gasUsed: "0x5208",
								size: "0x100",
							};
						else if (input.method === "eth_call") {
							assert.equal(
								input.params[1],
								"0x14",
								"Helper metadata must use the receipt block.",
							);
							const selector = input.params[0].data;
							result =
								selector === toFunctionSelector("ethRegistrar()")
									? encodeAbiParameters(parseAbiParameters("address"), [
											chain.ensRegistrarAddress as `0x${string}`,
										])
									: selector === toFunctionSelector("ethRenewerV1()")
										? encodeAbiParameters(parseAbiParameters("address"), [
												chain.ensRenewerV1Address as `0x${string}`,
											])
										: chain.ensReferrer;
						}
						res
							.writeHead(200, { "content-type": "application/json" })
							.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
					});
					await new Promise<void>((resolve) =>
						server.listen(0, "127.0.0.1", resolve),
					);
					const old = process.env[chain.rpcEnv],
						address = server.address();
					assert.ok(address && typeof address !== "string");
					process.env[chain.rpcEnv] = `http://127.0.0.1:${address.port}`;
					try {
						for (const [id, type, index] of [
							["exact-renewal", "Renewed", 2],
							["exact-source", "DepositProcessed", 3],
						])
							await pool.query(
								"insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts,payload,payload_expires_at) values($1,'namepass',$2,$3,$4,$5,20,now(),'c',true,'{}','{}',now())",
								[id, type, chain.chainId, hash, index],
							);
						const flow = (
							await pool.query(
								"insert into flows(name_id,origin_chain_id,status,trigger,amount_detected,origin_event_id,renewal_event_id,origin_evidence_tx_hash) values($1,$2,'settled','external',1000000,'exact-source','exact-renewal',$3) returning id",
								[n, chain.chainId, hash],
							)
						).rows[0].id;
						logs[1].data = ensData(800000n);
						await assert.rejects(verifyFlow(flow), /ens_accounting_mismatch/);
						assert.equal(
							(
								await pool.query(
									"select count(*)::int as n from integration_settlements where flow_id=$1",
									[flow],
								)
							).rows[0].n,
							0,
						);
						logs[1].data = ensData(900000n);
						await assert.rejects(verifyFlow(flow), /hub_finality_pending/);
						assert.equal(
							(
								await pool.query(
									"select status from integration_settlements where flow_id=$1",
									[flow],
								)
							).rows[0].status,
							"observed",
						);
						final = true;
						await verifyFlow(flow);
						await db.transaction((tx) => publishBatch(tx as never));
						const { getResource } = await import("./reads");
						const settlement = await getResource(
							a,
							"settlement",
							`${chain.chainId}:${hash}:2`,
						);
						assertContract("Settlement", settlement);
						const { flowResource } = await import("./resources");
						assertContract("FlowDetail", await flowResource(a, flow));
						assert.equal(settlement.status, "finalized");
						assert.equal(settlement.durationSeconds, "100");
						await pool.query(
							"update chain_events set canonical=false where event_id='exact-renewal'",
						);
						assert.equal(
							(
								await pool.query(
									"select status from integration_settlements where flow_id=$1",
									[flow],
								)
							).rows[0].status,
							"invalidated",
						);
					} finally {
						if (old === undefined) delete process.env[chain.rpcEnv];
						else process.env[chain.rpcEnv] = old;
						await new Promise<void>((resolve, reject) =>
							server.close((e) => (e ? reject(e) : resolve())),
						);
					}
				},
			);
			await t.test(
				"pooled deposits complete only with complete coverage and every candidate final settlement",
				async () => {
					const { recomputeConsumption } = await import("./evidence");
					const txHash = "0x" + "cd".repeat(32),
						blockHash = "0x" + "ee".repeat(32);
					const flow = (
						await pool.query(
							"insert into flows(name_id,origin_chain_id,status,trigger,amount_detected) values($1,84532,'settled','external',10000000) returning id",
							[n],
						)
					).rows[0].id;
					for (const [id, amount, index] of [
						["deposit-a", "3000000", 0],
						["deposit-b", "7000000", 1],
					] as const) {
						await pool.query(
							"insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts,payload,payload_expires_at) values($1,'deposit','Transfer',84532,$2,$3,10,now(),'c',true,'{}','{}',now())",
							[id, txHash, index],
						);
						await pool.query(
							"insert into deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status) values($1,$2,84532,$3,$3,$4,$5,$6,10,now(),'goldsky','detected')",
							[id, n, "0x" + "44".repeat(20), amount, txHash, index],
						);
						await pool.query(
							"insert into integration_evidence(id,chain_id,tx_hash,block_number,block_hash,transaction_index,log_index,receipt) values($1,84532,$2,10,$3,0,$4,'{}')",
							[id, txHash, blockHash, index],
						);
					}
					await pool.query(
						"insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts,payload,payload_expires_at) values('drain','namepass','DepositProcessed',84532,$1,9,11,now(),'c',true,$2,'{}',now())",
						[
							txHash,
							{
								wallet_address: "0x" + "33".repeat(20),
								remaining_amount: "0",
								amount: "10000000",
							},
						],
					);
					await pool.query(
						"update flows set origin_event_id='drain' where id=$1",
						[flow],
					);
					await pool.query(
						"insert into integration_evidence(id,chain_id,tx_hash,block_number,block_hash,transaction_index,log_index,receipt) values('drain',84532,$1,11,$2,0,9,'{}')",
						[txHash, blockHash],
					);
					await pool.query(
						"insert into integration_coverage(name_id,chain_id,from_block,through_block,status) values($1,84532,10,11,'covered')",
						[n],
					);
					await db.transaction((tx) => publishBatch(tx as never));
					const { getResource } = await import("./reads");
					assert.equal(
						(await getResource(a, "flow", flow)).status,
						"verifying_settlement",
					);
					await pool.query(
						"insert into integration_settlements(id,flow_id,name_id,status,evidence,amounts,duration_seconds) values('renewal',$1,$2,'observed','{}','{}',31536000)",
						[flow, n],
					);
					await recomputeConsumption(n, "84532");
					assert.deepEqual(
						(
							await pool.query(
								`select status from integration_consumptions where id in ('deposit-a','deposit-b') order by id`,
							)
						).rows.map((r) => r.status),
						["consumed", "consumed"],
					);
					await pool.query(
						"update integration_settlements set status='finalized',finalized_at=now() where id='renewal'",
					);
					await recomputeConsumption(n, "84532");
					assert.deepEqual(
						(
							await pool.query(
								`select status from integration_consumptions where id in ('deposit-a','deposit-b') order by id`,
							)
						).rows.map((r) => r.status),
						["completed", "completed"],
					);
					await db.transaction((tx) => publishBatch(tx as never));
					assert.equal((await getResource(a, "flow", flow)).status, "settled");
					await pool.query(
						"update integration_settlements set status='invalidated',finalized_at=null where id='renewal'",
					);
					assert.deepEqual(
						(
							await pool.query(
								`select status from integration_consumptions where id in ('deposit-a','deposit-b') order by id`,
							)
						).rows.map((r) => r.status),
						["unresolved", "unresolved"],
						"Invalidation must commit before the repair worker runs.",
					);
					await recomputeConsumption(n, "84532");
					await db.transaction((tx) => publishBatch(tx as never));
					assert.equal(
						(await getResource(a, "flow", flow)).status,
						"verifying_settlement",
					);
					assert.deepEqual(
						(
							await pool.query(
								`select status from integration_consumptions where id in ('deposit-a','deposit-b') order by id`,
							)
						).rows.map((r) => r.status),
						["consumed", "consumed"],
					);
					await pool.query(
						"update integration_settlements set status='finalized',finalized_at=now() where id='renewal'",
					);
					await recomputeConsumption(n, "84532");
					await pool.query(
						"update chain_events set canonical=false where event_id='drain'",
					);
					assert.equal(
						(
							await pool.query(
								"select canonical from integration_evidence where id='drain'",
							)
						).rows[0].canonical,
						false,
					);
					assert.equal(
						(
							await pool.query(
								"select status from integration_settlements where id='renewal'",
							)
						).rows[0].status,
						"invalidated",
					);
					assert.ok(
						(
							await pool.query("select status from integration_consumptions")
						).rows.every((r) => r.status !== "completed"),
					);
					await recomputeConsumption(n, "84532");
					assert.ok(
						(
							await pool.query("select status from integration_consumptions")
						).rows.every((r) => r.status !== "completed"),
					);
				},
			);
			await t.test(
				"sensitive transaction fields never enter the journal",
				async () => {
					await pool.query(
						"update flows set cctp_message='PRIVATE_MESSAGE_FIXTURE',cctp_attestation='PRIVATE_ATTESTATION_FIXTURE' where name_id=$1",
						[n],
					);
					const serialized = JSON.stringify(
						(await pool.query("select payload from integration_outbox")).rows,
					);
					assert.ok(!serialized.includes("PRIVATE_MESSAGE_FIXTURE"));
					assert.ok(!serialized.includes("PRIVATE_ATTESTATION_FIXTURE"));
				},
			);
			await t.test(
				"pagination freezes more than one hundred changing resources and retention keeps its baseline",
				async () => {
					const { listResources, createSnapshot, snapshotPage, listEvents } =
						await import("./reads");
					await pool.query(
						`insert into flows(name_id,origin_chain_id,status,trigger,amount_detected)
          select $1,84532,'settled','external',1234567 from generate_series(1,125)`,
						[n],
					);
					while (await db.transaction((tx) => publishBatch(tx as never))) {}
					const first = await listResources(
						a,
						"flow",
						new URLSearchParams({ limit: "20", name: "alice.eth" }),
					);
					const snapshot = await createSnapshot(a);
					await pool.query(
						"update flows set amount_detected=7654321 where name_id=$1",
						[n],
					);
					while (await db.transaction((tx) => publishBatch(tx as never))) {}
					const items = [...first.items];
					let cursor = first.nextCursor;
					while (cursor) {
						const page = await listResources(
							a,
							"flow",
							new URLSearchParams({ limit: "20", name: "alice.eth", cursor }),
						);
						assert.equal(page.asOf, first.asOf);
						items.push(...page.items);
						cursor = page.nextCursor;
					}
					assert.equal(
						items.filter((item) => item.amountDetected === "1234567").length,
						125,
					);
					assert.equal(
						new Set(items.map((item) => item.id)).size,
						items.length,
					);
					await assert.rejects(
						listResources(
							a,
							"flow",
							new URLSearchParams({
								cursor: first.nextCursor!,
								status: "settled",
							}),
						),
						/change filters/,
					);
					// Simulate expiry of replay while keeping a live snapshot at its older head.
					await pool.query(
						"update integration_events set published_at=now()-interval '91 days'",
					);
					await pool.query("delete from integration_snapshots where id<>$1", [
						snapshot.id,
					]);
					process.env.NAMEPASS_INTEGRATIONS_ENABLED = "1";
					try {
						await (await import("./retention")).retainIntegrations();
					} finally {
						process.env.NAMEPASS_INTEGRATIONS_ENABLED = "0";
					}
					const snapItems: Record<string, unknown>[] = [];
					let next: string | null = snapshot.nextCursor;
					while (next) {
						const page = await snapshotPage(
							a,
							snapshot.id,
							new URLSearchParams({ cursor: next, limit: "30" }),
						);
						snapItems.push(...page.items);
						next = page.nextCursor;
					}
					assert.equal(
						snapItems.filter(
							(item) =>
								item.resourceType === "flow" &&
								item.amountDetected === "1234567",
						).length,
						125,
					);
					await assert.rejects(
						listEvents(
							a,
							new URLSearchParams({
								cursor: encodeCursor({
									partner: a,
									kind: "events",
									position: "0",
								}),
							}),
						),
						/sync snapshot/,
					);
					assert.equal(
						(
							await pool.query(
								"select count(*)::int as n from flows where name_id=$1",
								[n],
							)
						).rows[0].n,
						items.length,
					);
				},
			);
		} finally {
			process.env.NAMEPASS_INTEGRATIONS_ENABLED = "0";
			await pool.end();
			const { database } = await import("../db/client");
			await (database() as unknown as { $client: Pool }).$client.end();
			await admin.query(`drop database "${name}" with (force)`);
			await admin.end();
		}
	},
);
