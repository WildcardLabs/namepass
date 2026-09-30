import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { SERVER_CHAINS } from "../src/lib/chains";

// The integration regression previously applied all migrations, which concealed
// incompatibility with beta. Keep this fixture at the deployed 0008 schema.
test("beta schema: explorer reads and Goldsky writes work before integration migrations", {
	skip: !process.env.TEST_DATABASE_URL,
	timeout: 60000,
}, async (t) => {
	const url = new URL(process.env.TEST_DATABASE_URL!);
	assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
		"This test creates a disposable database on a loopback PostgreSQL server.");
	const admin = new Pool({ connectionString: url.toString() });
	const dbName = `namepass_beta_schema_${process.pid}_${Date.now()}`;
	await admin.query(`create database "${dbName}"`);
	url.pathname = "/" + dbName;
	process.env.DATABASE_URL = url.toString();
	delete process.env.NAMEPASS_INTEGRATIONS_ENABLED;
	delete process.env.RELAYER_PRIVATE_KEY;
	process.env.RELAYER_ADDRESS = "0x0000000000000000000000000000000000000001";
	const pool = new Pool({ connectionString: url.toString() });
	try {
		for (const file of (await readdir("drizzle")).filter(f => /^000[0-8]_.*\.sql$/.test(f)).sort()) {
			await pool.query(await readFile("drizzle/" + file, "utf8"));
		}
		const absentColumns = await pool.query(`select column_name from information_schema.columns
			where table_schema='public' and ((table_name='chain_events' and column_name='evidence_kind')
			or (table_name='deposits' and column_name='transfer_kind'))`);
		assert.equal(absentColumns.rowCount, 0);
		const aliceAddress = "0x" + "33".repeat(20);
		const aliceHash = "0x" + "11".repeat(32);
		const bobHash = "0x" + "22".repeat(32);
		async function seedName(label: string, labelHash: string, address: string) {
			return (await pool.query(`insert into names(normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
				values($1,$2,$3,$4,$5,now()) returning id`,
				[label, label + ".eth", labelHash, labelHash, address])).rows[0].id as string;
		}
		const aliceId = await seedName("alice", aliceHash, aliceAddress);
		const bobId = await seedName("bob", bobHash, "0x" + "44".repeat(20));
		for (const [id, nameId, labelHash, canonical, time] of [
			["renewal:1", aliceId, aliceHash, true, "2026-09-20T12:00:00Z"],
			["renewal:2", aliceId, aliceHash, true, "2026-09-21T12:00:00Z"],
			["renewal:3", bobId, bobHash, true, "2026-09-22T12:00:00Z"],
			["renewal:4", aliceId, aliceHash, false, "2026-09-23T12:00:00Z"],
		] as const) {
			const facts = { label_hash: labelHash, executor_address: process.env.RELAYER_ADDRESS,
				amount_received: "5000000", gas_allowance: "100000", amount_applied: "4900000",
				duration: "31536000", new_expiry: "2000000000", from_cctp: "false" };
			await pool.query(`insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,
				block_number,block_time,gs_op,canonical,facts) values($1,'namepass','Renewed',11155111,$2,1,10,$3,'c',$4,$5)`,
				[id, "0x" + id.slice(-1).repeat(64), time, canonical, JSON.stringify(facts)]);
			await pool.query(`insert into flows(name_id,renewal_event_id,origin_chain_id,trigger,status,amount_detected)
				values($1,$2,11155111,'external','settled',5000000)`, [nameId, id]);
		}
		await t.test("explorer paginates canonical renewals and keeps name history scoped", async () => {
			const route = (await import("../routes/api/activity")).default;
			const first = await route.fetch(new Request("https://namepass.example/api/activity?page=1&limit=2"));
			assert.equal(first.status, 200);
			const body = await first.json();
			assert.equal(body.totalItems, 3);
			assert.equal(body.totalPages, 2);
			assert.deepEqual(body.items.map((row: { renewal: { eventId: string } }) => row.renewal.eventId), ["renewal:3", "renewal:2"]);
			assert.equal(body.items[0].renewal.amountApplied, "4900000");
			assert.equal(body.items[0].renewal.expiryAfter, "2033-05-18T03:33:20.000Z");
			const second = await route.fetch(new Request("https://namepass.example/api/activity?page=2&limit=2"));
			assert.equal(second.status, 200);
			assert.deepEqual((await second.json()).items.map((row: { renewal: { eventId: string } }) => row.renewal.eventId), ["renewal:1"]);
			const { nameActivity } = await import("./names");
			const history = await nameActivity("alice.eth", 20);
			assert.deepEqual(history.renewals.map(row => row.eventId), ["renewal:2", "renewal:1"]);
		});
		await t.test("authenticated ingestion stores a deposit once and exposes its queued flow", async () => {
			const { goldskyHandler, postgresGoldskyStore } = await import("./goldsky");
			const starts: string[] = [];
			// Only workflow dispatch is replaced; the handler and database store are real.
			const route = goldskyHandler(postgresGoldskyStore, async id => { starts.push(id); }, () => "fixture-secret");
			const chain = SERVER_CHAINS.find(c => c.chainId === 84532)!;
			const event = { event_id: "84532:deposit:fixture", event_family: "deposit", event_type: "Transfer",
				chain_id: 84532, block_number: 20, block_time: 1790164800000,
				tx_hash: "0x" + "5".repeat(64), log_index: 1, token_address: chain.usdcAddress.toLowerCase(),
				sender_address: "0x0000000000000000000000000000000000000001", recipient_address: aliceAddress,
				amount: "1000000", _gs_op: "c" };
			const request = (secret: string) => new Request("https://namepass.example/api/webhooks/goldsky", {
				method: "POST", headers: { "content-type": "application/json", authorization: secret }, body: JSON.stringify(event),
			});
			assert.equal((await route.fetch(request("wrong"))).status, 401);
			for (let i = 0; i < 2; i++) {
				const response = await route.fetch(request("fixture-secret"));
				assert.equal(response.status, 200);
				assert.deepEqual(await response.json(), { accepted: true });
			}
			assert.equal((await pool.query("select count(*)::int as n from deposits where event_id=$1", [event.event_id])).rows[0].n, 1);
			assert.equal((await pool.query("select count(*)::int as n from chain_events where event_id=$1", [event.event_id])).rows[0].n, 1);
			const stored = (await pool.query("select id,status,amount_detected::text from flows where deposit_event_id=$1", [event.event_id])).rows;
			assert.equal(stored.length, 1);
			assert.equal(stored[0].status, "queued");
			assert.equal(stored[0].amount_detected, "1000000");
			assert.deepEqual([...new Set(starts)], [stored[0].id]);
			const { activity } = await import("./reads");
			const live = await activity(12);
			assert.equal(live.flows.length, 1);
			assert.equal(live.flows[0].flow.evidence.depositTxHash, event.tx_hash);
			assert.equal(live.flows[0].name.displayName, "alice.eth");
		});
	} finally {
		const { database } = await import("./db/client");
		await (database() as unknown as { $client: Pool }).$client.end();
		await pool.end();
		await admin.query(`drop database "${dbName}"`);
		await admin.end();
	}
});
