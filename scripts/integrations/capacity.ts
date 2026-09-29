/** Disposable PostgreSQL capacity exercise. No RPC, wallet, provider or remote webhook calls. */
import { Pool } from "pg";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { publishBatch } from "../../server/integrations/journal";
import { listResources } from "../../server/integrations/reads";
import { database } from "../../server/db/client";
const supplied = process.env.TEST_DATABASE_URL;
if (!supplied) throw new Error("TEST_DATABASE_URL is required.");
const url = new URL(supplied);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
	throw new Error("Use disposable loopback PostgreSQL.");
const seconds = Number(process.env.CAPACITY_SECONDS ?? 900);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 1800)
	throw new Error("CAPACITY_SECONDS must be 10..1800.");
const admin = new Pool({ connectionString: url.toString() }),
	name = `namepass_capacity_test_${process.pid}`;
await admin.query(`create database "${name}"`);
url.pathname = "/" + name;
process.env.DATABASE_URL = url.toString();
process.env.INTEGRATION_CURSOR_SECRET =
	"disposable-capacity-cursor-secret-00000000";
const pool = new Pool({ connectionString: url.toString(), max: 16 }),
	db = drizzle(pool);
const latency: number[] = [],
	publishLatency: number[] = [];
let failures = 0,
	changes = 0,
	readCount = 0;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
try {
	for (const file of (await readdir("drizzle"))
		.filter((f) => f.endsWith(".sql"))
		.sort())
		await pool.query(await readFile("drizzle/" + file, "utf8"));
	await pool.query(`insert into names(id,normalized_label,display_name,label_hash,namehash,deposit_address,ens_synced_at)
 select md5('capacity-name-'||i)::uuid,'capacity-'||i,'capacity-'||i||'.eth','0x'||md5('label'||i)||md5('label'||i),'0x'||md5('hash'||i)||md5('hash'||i),'0x'||lpad(to_hex(i),40,'0'),now() from generate_series(1,10000)i`);
	const partners = (
		await pool.query(
			"insert into integration_partners(name) select 'capacity-'||i from generate_series(1,10)i returning id",
		)
	).rows.map((r) => r.id as string);
	await pool.query(
		"insert into integration_watches(partner_id,name_id) select p.id,n.id from integration_partners p cross join names n",
	);
	await pool.query(`insert into chain_events(event_id,event_family,event_type,chain_id,tx_hash,log_index,block_number,block_time,gs_op,canonical,facts,payload,payload_expires_at)
 select 'capacity-deposit-'||i,'deposit','Transfer',84532,'0x'||lpad(to_hex(i),64,'0'),0,100+i,now(),'c',true,'{}','{}',now() from generate_series(1,50000)i`);
	await pool.query(`insert into deposits(event_id,name_id,chain_id,token_address,sender_address,amount,tx_hash,log_index,block_number,block_time,source,status)
 select 'capacity-deposit-'||i,md5('capacity-name-'||((i-1)%10000+1))::uuid,84532,'0x'||repeat('a',40),'0x'||repeat('b',40),1000000,'0x'||lpad(to_hex(i),64,'0'),0,100+i,now(),'goldsky','detected' from generate_series(1,50000)i`);
	await pool.query(`insert into flows(id,name_id,origin_chain_id,status,trigger,amount_detected)
 select md5('capacity-flow-'||i)::uuid,md5('capacity-name-'||((i-1)%10000+1))::uuid,84532,'settled','external',1000000 from generate_series(1,50000)i`);
	// All seed transactions are already committed. Bulk-load historical published
	// projections so the timed run measures steady-state reads and new publication.
	await pool.query(`insert into integration_events(position,resource_kind,resource_id,revision,name_id,partner_id,event_type,payload,recorded_at)
 select id,resource_kind,resource_id,revision,name_id,partner_id,event_type,payload,recorded_at from integration_outbox`);
	await pool.query(`insert into integration_versions(resource_kind,resource_id,position,revision,name_id,partner_id,payload)
 select resource_kind,resource_id,position,revision,name_id,partner_id,payload from integration_events`);
	await pool.query("update integration_outbox set published=true");
	await pool.query(
		"update integration_publication set position=(select max(position) from integration_events)",
	);
	await pool.query("analyze");
	const start = Date.now(),
		end = start + seconds * 1000;
	console.log(
		"Capacity seed ready: 100000 flow/deposit records, 10000 names, 10 partners.",
	);
	const readers = partners.map(async (partner, index) => {
		let next = performance.now();
		while (Date.now() < end) {
			const at = performance.now();
			try {
				await listResources(
					partner,
					index % 2 ? "deposit" : "flow",
					new URLSearchParams({ limit: "50" }),
				);
				readCount++;
			} catch {
				failures++;
			}
			latency.push(performance.now() - at);
			next += 100;
			await delay(Math.max(0, next - performance.now()));
		}
	});
	const writer = (async () => {
		let next = performance.now();
		while (Date.now() < end) {
			const at = performance.now();
			await pool.query(
				"update names set current_expiry=now() where normalized_label=any($1)",
				[[1, 2, 3, 4].map((i) => "capacity-" + (((changes + i) % 10000) + 1))],
			);
			changes += 4;
			await db.transaction((tx) => publishBatch(tx as never, 100));
			publishLatency.push(performance.now() - at);
			next += 200;
			await delay(Math.max(0, next - performance.now()));
		}
	})();
	await Promise.all([...readers, writer]);
	while (await db.transaction((tx) => publishBatch(tx as never, 500))) {}
	const bounds = (
		await pool.query(
			"select min(position)::text as minimum,max(position)::text as maximum,count(*)::text as count from integration_events",
		)
	).rows[0];
	const noCursorGaps =
		BigInt(bounds.maximum) - BigInt(bounds.minimum) + 1n ===
		BigInt(bounds.count);
	const p95 = (values: number[]) =>
		values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
	const result = {
		measuredAt: new Date().toISOString(),
		scope:
			"Local PostgreSQL only; excludes hosted network, Workflow scheduling and webhook transport.",
		durationSeconds: seconds,
		retainedFlowDepositRecords: 100000,
		watchedNames: 10000,
		partners: 10,
		targetReadsPerSecond: 100,
		reads: readCount,
		actualReadsPerSecond: readCount / seconds,
		changes,
		changesPerSecond: changes / seconds,
		storedReadP95Ms: p95(latency),
		publicationBatchP95Ms: p95(publishLatency),
		failures,
		noCursorGaps,
		remainingOutbox: (
			await pool.query(
				"select count(*)::int as n from integration_outbox where not published",
			)
		).rows[0].n,
	};
	await writeFile(
		"/tmp/namepass-integration-capacity.json",
		JSON.stringify(result, null, 2) + "\n",
	);
	console.log(JSON.stringify(result));
	if (
		failures ||
		!noCursorGaps ||
		result.storedReadP95Ms >= 500 ||
		result.actualReadsPerSecond < 95
	)
		process.exitCode = 1;
} finally {
	await pool.end();
	await (database() as unknown as { $client: Pool }).$client.end();
	await admin.query(`drop database "${name}" with (force)`);
	await admin.end();
}
