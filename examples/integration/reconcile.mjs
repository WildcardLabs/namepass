import { Pool } from "pg";
import { saveEvent } from "./receiver.mjs";
const base = process.env.NAMEPASS_API,
	key = process.env.NAMEPASS_API_KEY;
if (!base || !key || !process.env.DATABASE_URL)
	throw new Error("Set NAMEPASS_API, NAMEPASS_API_KEY and DATABASE_URL.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function api(path, method = "GET") {
	const response = await fetch(base + path, {
		method,
		headers: {
			authorization: "Bearer " + key,
			...(method === "POST" ? { "content-type": "application/json" } : {}),
		},
		...(method === "POST" ? { body: "{}" } : {}),
	});
	const data = await response.json();
	if (!response.ok) {
		const error = new Error(data.error?.message ?? "Namepass request failed.");
		error.status = response.status;
		throw error;
	}
	return data;
}
async function bootstrap(client) {
	const snap = await api("/sync", "POST");
	let cursor = snap.nextCursor;
	// Stage the complete snapshot and checkpoint in one local transaction. For
	// very large integrations, use a staging table plus an atomic generation swap.
	await client.query("begin");
	try {
		for (;;) {
			const page = await api(
				`/sync/${snap.id}?cursor=${encodeURIComponent(cursor)}`,
			);
			for (const resource of page.items) {
				await client.query(
					`insert into namepass_resources(deployment_id,resource_type,resource_id,version,data)
     values($1,$2,$3,$4,$5) on conflict(deployment_id,resource_type,resource_id) do update set version=excluded.version,data=excluded.data
     where namepass_resources.version<excluded.version`,
					[
						resource.deploymentId,
						resource.resourceType,
						resource.id,
						resource.version,
						resource,
					],
				);
			}
			if (!page.hasMore) break;
			cursor = page.nextCursor;
		}
		await client.query(
			"insert into namepass_checkpoint(integration,cursor) values('default',$1) on conflict(integration) do update set cursor=excluded.cursor,updated_at=now()",
			[snap.eventsCursor],
		);
		await client.query("commit");
		return snap.eventsCursor;
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}
const client = await pool.connect();
try {
	// One reconciliation worker per integration. Webhook processing can continue;
	// resource versions prevent old snapshot data from replacing newer facts.
	await client.query(
		"select pg_advisory_lock(hashtextextended('namepass-reconciliation',0))",
	);
	let cursor = (
		await client.query(
			"select cursor from namepass_checkpoint where integration='default'",
		)
	).rows[0]?.cursor;
	if (!cursor) cursor = await bootstrap(client);
	for (;;) {
		let page;
		try {
			page = await api("/events?cursor=" + encodeURIComponent(cursor));
		} catch (error) {
			if (error.status === 410) {
				cursor = await bootstrap(client);
				continue;
			}
			throw error;
		}
		await client.query("begin");
		try {
			for (const event of page.items) await saveEvent(client, event);
			await client.query(
				"update namepass_checkpoint set cursor=$1,updated_at=now() where integration='default'",
				[page.nextCursor],
			);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
		cursor = page.nextCursor;
		if (!page.hasMore) break;
	}
} finally {
	await client.query(
		"select pg_advisory_unlock(hashtextextended('namepass-reconciliation',0))",
	);
	client.release();
	await pool.end();
}
