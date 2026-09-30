import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import {
	encodeEventTopics,
	encodeAbiParameters,
	parseAbiParameters,
	toFunctionSelector,
} from "viem";
import { Pool } from "pg";
import { chainById } from "../../src/lib/chains";
import {
	TRANSFER_ABI,
	receiptTransfers,
	selectTransfer,
	consumptionEvidence,
} from "./receipts";
import { HUB_CHAIN, SERVER_CHAINS } from "../../src/lib/chains";
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
	assert.ok(validate(value), JSON.stringify(validate.errors));
}
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
	"real PostgreSQL: anonymous address activation, transaction polling and verified renewal",
	{ skip: !process.env.TEST_DATABASE_URL, timeout: 120000 },
	async (t) => {
		const url = new URL(process.env.TEST_DATABASE_URL!);
		assert.ok(
			["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
			"Tests require a disposable loopback PostgreSQL server.",
		);
		const admin = new Pool({ connectionString: url.toString() });
		const name = `namepass_public_test_${process.pid}_${Date.now()}`;
		await admin.query(`create database "${name}"`);
		url.pathname = "/" + name;
		process.env.DATABASE_URL = url.toString();
		process.env.NAMEPASS_INTEGRATIONS_ENABLED = "1";
		const pool = new Pool({ connectionString: url.toString(), max: 8 });
		try {
			for (const file of (await readdir("drizzle"))
				.filter((f) => f.endsWith(".sql"))
				.sort())
				await pool.query(await readFile("drizzle/" + file, "utf8"));
			const n = (
				await pool.query(
					"insert into names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at) values('alice','alice.eth',$1,$2,$3,now()) returning id",
					[
						"0x" + "11".repeat(32),
						"0x" + "22".repeat(32),
						"0x" + "33".repeat(20),
					],
				)
			).rows[0].id;
			const addressRoute = (await import("../../routes/api/v1/address"))
				.default;
			const statusRoute = (await import("../../routes/api/v1/status/[chainId]"))
				.default;
			await t.test(
				"get an address without credentials; repeated requests keep the same address",
				async () => {
					const previous = new Map(
						SERVER_CHAINS.map((c) => [c.rpcEnv, process.env[c.rpcEnv]]),
					);
					const helper = ("0x" + "12".repeat(20)) as `0x${string}`;
					const word = (value: string) =>
						"0x" + value.replace(/^0x/, "").padStart(64, "0");
					const answers = new Map<string, string>([
						[toFunctionSelector("currentHelper()"), word(helper)],
						[toFunctionSelector("gateway()"), word(HUB_CHAIN.gatewayAddress!)],
						[toFunctionSelector("pointer()"), word(HUB_CHAIN.pointerAddress!)],
						[toFunctionSelector("interfaceVersion()"), word("1")],
						[toFunctionSelector("factory()"), word(HUB_CHAIN.factoryAddress!)],
						[toFunctionSelector("paymentToken()"), word(HUB_CHAIN.usdcAddress)],
						[
							toFunctionSelector("ethRegistrar()"),
							word(HUB_CHAIN.ensRegistrarAddress!),
						],
						[
							toFunctionSelector("ethRenewerV1()"),
							word(HUB_CHAIN.ensRenewerV1Address!),
						],
						[toFunctionSelector("referrer()"), HUB_CHAIN.ensReferrer!],
						[
							toFunctionSelector("nameState(string)"),
							encodeAbiParameters(parseAbiParameters("uint256,address"), [
								2000000000n,
								HUB_CHAIN.ensRegistrarAddress as `0x${string}`,
							]),
						],
						[toFunctionSelector("balanceOf(address)"), word("0")],
					]);
					const server = createServer(async (req, res) => {
						let raw = "";
						for await (const part of req) raw += part;
						const input = JSON.parse(raw);
						const reply = (call: {
							id: number;
							method: string;
							params: Array<{ data: string }>;
						}) => {
							const result =
								call.method === "eth_chainId"
									? "0x" + Number(req.url!.slice(1)).toString(16)
									: call.method === "eth_blockNumber"
										? "0x14"
										: answers.get(call.params[0].data.slice(0, 10));
							assert.notEqual(result, undefined, call.method);
							return { jsonrpc: "2.0", id: call.id, result };
						};
						res
							.writeHead(200, { "content-type": "application/json" })
							.end(
								JSON.stringify(
									Array.isArray(input) ? input.map(reply) : reply(input),
								),
							);
					});
					await new Promise<void>((resolve) =>
						server.listen(0, "127.0.0.1", resolve),
					);
					const local = server.address();
					assert.ok(local && typeof local !== "string");
					for (const c of SERVER_CHAINS)
						process.env[c.rpcEnv] =
							`http://127.0.0.1:${local.port}/${c.chainId}`;
					try {
						const activate = () =>
							addressRoute.fetch(
								new Request("https://namepass.example/api/v1/address", {
									method: "POST",
									headers: { "content-type": "application/json" },
									body: JSON.stringify({ name: "example.eth" }),
								}),
							);
						const response = await activate();
						assert.equal(response.status, 200);
						assert.equal(
							response.headers.get("access-control-allow-origin"),
							"*",
						);
						const body = await response.json();
						assertContract("AddressResponse", body);
						assert.equal(body.name, "example.eth");
						assert.equal(body.subname, "example.namepass.eth");
						assert.equal(body.subnameVerified, false);
						assert.match(body.depositAddress, /^0x[0-9a-f]{40}$/i);
						assert.ok(body.chains.length > 0);
						assert.equal(
							(await (await activate()).json()).depositAddress,
							body.depositAddress,
						);
						assert.equal(
							(
								await pool.query(
									"select count(*)::int as n from goldsky.watched_addresses where value=$1",
									[body.depositAddress.toLowerCase()],
								)
							).rows[0].n,
							1,
						);
					} finally {
						for (const [key, value] of previous) {
							if (value === undefined) delete process.env[key];
							else process.env[key] = value;
						}
						await new Promise<void>((resolve, reject) =>
							server.close((e) => (e ? reject(e) : resolve())),
						);
					}
				},
			);
			await t.test(
				"first status poll discovers a missed deposit and late indexing keeps one identity",
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
						const { canonicalReceipt, storeEvidence, verifyDeposit } =
							await import("./evidence");
						const pollRequest = () =>
							new Request(
								`https://namepass.example/api/v1/status/84532?transactionHash=${hash}`,
							);
						assert.equal((await statusRoute.fetch(pollRequest())).status, 404);
						assert.equal((await statusRoute.fetch(pollRequest())).status, 404);
						assert.equal(
							(
								await pool.query(
									"select count(*)::int as n from integration_jobs where key=$1",
									[`discover:84532:${hash}`],
								)
							).rows[0].n,
							1,
						);
						const { processJob } = await import("./worker");
						assert.equal(await processJob(), true);
						const transfer = { deposit_id: `84532:log_${hash}_5` };
						const discovered = await (
							await statusRoute.fetch(pollRequest())
						).json();
						assertContract("StatusResponse", discovered);
						assert.equal(discovered.status, "processing");
						assert.equal(discovered.deposits[0].amount, "100000");
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
						await ingestGoldskyEvent(
							postgresGoldskyStore,
							event,
							undefined,
							true,
						);
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
						await ingestGoldskyEvent(
							postgresGoldskyStore,
							removed,
							undefined,
							true,
						);
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
				"poll every log in a transaction; no complete status before coverage and final settlement",
				async () => {
					const { recomputeConsumption } = await import("./evidence");
					const txHash = "0x" + "cd".repeat(32),
						blockHash = "0x" + "ee".repeat(32),
						renewalHash = "0x" + "ab".repeat(32);
					const request = (chain = "84532", hash = txHash, extra = "") =>
						new Request(
							`https://namepass.example/api/v1/status/${chain}?transactionHash=${hash}${extra}`,
						);
					const poll = async () => {
						const response = await statusRoute.fetch(request());
						assert.equal(response.status, 200);
						const body = await response.json();
						assertContract("StatusResponse", body);
						return body;
					};
					const missing = await statusRoute.fetch(request());
					assert.equal(missing.status, 404);
					assert.equal(missing.headers.get("retry-after"), "5");
					assert.equal(missing.headers.get("access-control-allow-origin"), "*");
					for (const req of [
						request("1"),
						request("84532", "0x123"),
						request("84532", txHash, "&transactionHash=" + txHash),
						request("84532", txHash, "&cursor=x"),
					])
						assert.equal((await statusRoute.fetch(req)).status, 400);
					const options = await statusRoute.fetch(
						new Request(request().url, { method: "OPTIONS" }),
					);
					assert.equal(options.status, 204);
					assert.equal(
						(
							await statusRoute.fetch(
								new Request(request().url, { method: "POST" }),
							)
						).status,
						405,
					);
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
					}
					assert.equal((await poll()).status, "pending");
					assert.equal(
						(await statusRoute.fetch(request(String(HUB_CHAIN.chainId))))
							.status,
						404,
						"Hash lookup must also match the source chain.",
					);
					for (const [id, index] of [
						["deposit-a", 0],
						["deposit-b", 1],
					] as const)
						await pool.query(
							"insert into integration_evidence(id,chain_id,tx_hash,block_number,block_hash,transaction_index,log_index,receipt) values($1,84532,$2,10,$3,0,$4,'{}')",
							[id, txHash, blockHash, index],
						);
					assert.equal((await poll()).status, "processing");
					await pool.query(
						"insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts,payload,payload_expires_at) values('drain','namepass','DepositProcessed',84532,$1,9,11,now(),'c',true,$2,'{}',now()),('poll-renewal','namepass','Renewed',$3,$4,2,20,now(),'c',true,'{}','{}',now())",
						[
							txHash,
							{
								wallet_address: "0x" + "33".repeat(20),
								remaining_amount: "0",
								amount: "10000000",
							},
							HUB_CHAIN.chainId,
							renewalHash,
						],
					);
					const flow = (
						await pool.query(
							"insert into flows(name_id,origin_chain_id,status,trigger,amount_detected,origin_event_id,renewal_event_id) values($1,84532,'settled','external',10000000,'drain','poll-renewal') returning id",
							[n],
						)
					).rows[0].id;
					await pool.query(
						"insert into integration_evidence(id,chain_id,tx_hash,block_number,block_hash,transaction_index,log_index,receipt) values('drain',84532,$1,11,$2,0,9,'{}')",
						[txHash, blockHash],
					);
					await pool.query(
						"insert into integration_settlements(id,flow_id,name_id,status,evidence,amounts,duration_seconds,expiry_after) values('poll-settlement',$1,$2,'observed',$3,'{}',31536000,'2030-01-01T00:00:00Z')",
						[
							flow,
							n,
							{
								hub: {
									chainId: String(HUB_CHAIN.chainId),
									txHash: renewalHash,
								},
							},
						],
					);
					await recomputeConsumption(n, "84532");
					assert.equal((await poll()).status, "processing");
					await pool.query(
						"insert into integration_coverage(name_id,chain_id,from_block,through_block,status) values($1,84532,10,11,'covered')",
						[n],
					);
					await recomputeConsumption(n, "84532");
					assert.equal((await poll()).status, "processing");
					assert.deepEqual((await poll()).deposits[0].renewals, []);
					await pool.query(
						"update integration_settlements set status='finalized',finalized_at=now() where id='poll-settlement'",
					);
					await recomputeConsumption(n, "84532");
					const complete = await poll();
					assert.equal(complete.status, "complete");
					assert.deepEqual(
						complete.deposits.map((d: { amount: string }) => d.amount),
						["3000000", "7000000"],
					);
					assert.deepEqual(
						complete.deposits.map((d: { status: string }) => d.status),
						["complete", "complete"],
					);
					assert.deepEqual(complete.deposits[0].renewals, [
						{
							chainId: String(HUB_CHAIN.chainId),
							transactionHash: renewalHash,
							secondsAdded: "31536000",
							expiry: "2030-01-01T00:00:00+00:00",
						},
					]);
					assert.equal(
						(
							await (
								await statusRoute.fetch(
									request("84532", txHash.toUpperCase().replace("0X", "0x")),
								)
							).json()
						).status,
						"complete",
					);
					await pool.query(
						"update chain_events set log_index=5 where event_id='deposit-a'",
					);
					assert.equal(
						(await poll()).status,
						"processing",
						"A source identity correction must revoke completion without waiting for a worker.",
					);
					assert.deepEqual((await poll()).deposits[0].renewals, []);

					await pool.query(
						"update chain_events set canonical=false where event_id='poll-renewal'",
					);
					assert.equal(
						(await poll()).status,
						"processing",
						"A revoked renewal must stop reporting complete before the repair worker runs.",
					);
					await pool.query(
						"update chain_events set canonical=false where event_id='deposit-b'",
					);
					assert.equal((await poll()).status, "failed");
					assert.equal(
						(await poll()).deposits[1].reason,
						"transaction_orphaned",
					);
					process.env.NAMEPASS_INTEGRATIONS_ENABLED = "0";
					assert.equal((await statusRoute.fetch(request())).status, 503);
					process.env.NAMEPASS_INTEGRATIONS_ENABLED = "1";
				},
			);
			await t.test(
				"renewal history filters one name and pages equal-timestamp events without exposing other names",
				async () => {
					const route = (
						await import("../../routes/api/v1/names/[name]/renewals")
					).default;
					const other = (
						await pool.query(
							"select id from names where normalized_label='example'",
						)
					).rows[0].id;
					for (const [id, nameId] of [
						["history-1", n],
						["history-2", n],
						["history-3", n],
						["other-history", other],
					]) {
						const hash =
							"0x" +
							(id === "other-history" ? "ff" : id.slice(-1).repeat(2)).repeat(
								32,
							);
						await pool.query(
							"insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts,payload,payload_expires_at) values($1,'namepass','DepositProcessed',$2,$3,1,20,'2026-09-29T12:00:00Z','c',true,'{}','{}',now()),($4,'namepass','Renewed',$2,$3,2,20,'2026-09-29T12:00:00Z','c',true,$5,'{}',now())",
							[
								id + "-source",
								HUB_CHAIN.chainId,
								hash,
								id,
								{
									duration: "100",
									amount_applied: "900000",
									gas_allowance: "100000",
								},
							],
						);
						const flow = (
							await pool.query(
								"insert into flows(name_id,origin_chain_id,status,trigger,amount_detected,origin_event_id,renewal_event_id,expiry_after) values($1,$2,'settled','external',1000000,$3,$4,'2030-01-01T00:00:00Z') returning id",
								[nameId, HUB_CHAIN.chainId, id + "-source", id],
							)
						).rows[0].id;
						await pool.query(
							"insert into integration_settlements(id,flow_id,name_id,status,evidence,amounts,duration_seconds,expiry_after,finalized_at) values($1,$2,$3,$4,'{}',$5,100,'2030-01-01T00:00:00Z',now())",
							[
								id,
								flow,
								nameId,
								id === "history-1" ? "observed" : "finalized",
								{ amountApplied: "900000", executorAllowance: "100000" },
							],
						);
					}
					const request = (name = "Alice.eth", query = "limit=2") =>
						new Request(
							`https://namepass.example/api/v1/names/${name}/renewals?${query}`,
						);
					const response = await route.fetch(request());
					assert.equal(response.status, 200);
					const first = await response.json();
					assertContract("HistoryResponse", first);
					assert.equal(first.name, "alice.eth");
					assert.equal(first.items.length, 2);
					assert.ok(first.nextCursor);
					assert.deepEqual(
						first.items.map(
							(i: { transactionHash: string }) => i.transactionHash,
						),
						["0x" + "33".repeat(32), "0x" + "22".repeat(32)],
					);
					assert.ok(
						first.items.every(
							(i: { status: string }) => i.status === "complete",
						),
					);
					const second = await (
						await route.fetch(
							request(
								"alice",
								"limit=2&cursor=" + encodeURIComponent(first.nextCursor),
							),
						)
					).json();
					assertContract("HistoryResponse", second);
					assert.equal(second.items.length, 1);
					assert.equal(second.items[0].transactionHash, "0x" + "11".repeat(32));
					assert.equal(second.items[0].status, "processing");
					assert.equal(second.nextCursor, null);
					const scoped = await (
						await route.fetch(
							request(
								"example.eth",
								"limit=2&cursor=" + encodeURIComponent(first.nextCursor),
							),
						)
					).json();
					assert.equal(scoped.name, "example.eth");
					assert.ok(
						scoped.items.every(
							(i: { transactionHash: string }) =>
								i.transactionHash === "0x" + "ff".repeat(32),
						),
					);
					for (const query of [
						"limit=0",
						"limit=101",
						"limit=2&limit=3",
						"page=1",
						"cursor=bad",
					])
						assert.equal(
							(await route.fetch(request("alice", query))).status,
							400,
						);
					assert.equal(
						(await route.fetch(request("unactivated.eth"))).status,
						404,
					);
					await pool.query(
						"update chain_events set canonical=false where event_id='history-3'",
					);
					const corrected = await (await route.fetch(request())).json();
					assert.ok(
						corrected.items.every(
							(i: { transactionHash: string }) =>
								i.transactionHash !== "0x" + "33".repeat(32),
						),
					);
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
					await pool.query("update names set label_hash=$1 where id=$2", [key, n]);
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
						const settlement = (
							await pool.query(
								"select status,duration_seconds::text from integration_settlements where flow_id=$1",
								[flow],
							)
						).rows[0];
						assert.equal(settlement.status, "finalized");
						assert.equal(settlement.duration_seconds, "100");
						await pool.query(
							"update flows set origin_event_id=null,origin_evidence_tx_hash=null,trigger='external' where id=$1",
							[flow],
							);
						await verifyFlow(flow);
						assert.equal(
							(await pool.query("select origin_event_id from flows where id=$1", [flow])).rows[0].origin_event_id,
							"exact-source",
							"Historical external renewals recover only their exact receipt source.",
						);
						const { ingestGoldskyEvent, postgresGoldskyStore } = await import("../goldsky");
						const replay = {
							eventFamily: "namepass" as const, chainId: chain.chainId,
							txHash: hash, blockNumber: "20", blockTime: new Date(100000),
							gsOp: "c" as const, payload: {},
						};
						await ingestGoldskyEvent(postgresGoldskyStore, {
							...replay, eventId: "exact-source", eventType: "DepositProcessed", logIndex: 3,
							facts: { wallet_address: wallet, label_key: key, amount: "1000000", remaining_amount: "0" },
						});
						const renewalReplay = {
							...replay, eventId: "exact-renewal", eventType: "Renewed", logIndex: 2,
							facts: { wallet_address: wallet, label_hash: key, label: "alice", duration: "100",
								amount_received: "1000000", gas_allowance: "100000", amount_applied: "900000",
								remainder: "0", from_cctp: "false", new_expiry: "2000000000" },
						};
						await pool.query("update flows set origin_evidence_tx_hash=$1 where id=$2", ["0x" + "ff".repeat(32), flow]);
						await assert.rejects(
							ingestGoldskyEvent(postgresGoldskyStore, renewalReplay),
							/conflicts with a non-external flow/,
						);
						await pool.query("update flows set origin_evidence_tx_hash=$1 where id=$2", [hash, flow]);
						await ingestGoldskyEvent(postgresGoldskyStore, renewalReplay);
						assert.equal(
							(await pool.query("select origin_event_id from flows where id=$1", [flow])).rows[0].origin_event_id,
							"exact-source", "Receipt replay preserves the recovered direct source.",
						);
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
		} finally {
			process.env.NAMEPASS_INTEGRATIONS_ENABLED = "0";
			await pool.end();
			const { database } = await import("../db/client");
			await (database() as unknown as { $client: Pool }).$client.end();
			await admin.query(`drop database "${name}"`);
			await admin.end();
		}
	},
);
