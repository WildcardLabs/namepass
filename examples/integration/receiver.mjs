import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export function verifyWebhook(
	raw,
	headers,
	secrets,
	now = Math.floor(Date.now() / 1000),
) {
	const id = headers["webhook-id"],
		timestamp = headers["webhook-timestamp"],
		signatures = headers["webhook-signature"];
	if (
		typeof id !== "string" ||
		typeof timestamp !== "string" ||
		typeof signatures !== "string" ||
		!/^\d+$/.test(timestamp) ||
		Math.abs(now - Number(timestamp)) > 300
	)
		throw new Error("Invalid webhook headers.");
	const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw]);
	const valid = secrets.some((secret) => {
		const expected = createHmac(
			"sha256",
			Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
		)
			.update(signed)
			.digest();
		return signatures.split(" ").some((value) => {
			const [version, signature] = value.split(",");
			if (version !== "v1" || !signature) return false;
			const actual = Buffer.from(signature, "base64");
			return (
				actual.length === expected.length && timingSafeEqual(actual, expected)
			);
		});
	});
	if (!valid) throw new Error("Invalid webhook signature.");
	const event = JSON.parse(raw.toString("utf8"));
	if (event.id !== id) throw new Error("Event identity mismatch.");
	return event;
}
export async function saveEvent(client, event) {
	const result = await client.query(
		"insert into namepass_inbox(event_id,envelope) values($1,$2) on conflict do nothing returning event_id",
		[event.id, event],
	);
	if (!result.rows.length) return;
	if (event.type.startsWith("endpoint.")) return;
	if (
		!/^\d+$/.test(event.resourceVersion) ||
		!event.deploymentId ||
		!event.resourceType ||
		!event.resourceId
	)
		throw new Error("Invalid event resource.");
	await client.query(
		`insert into namepass_resources(deployment_id,resource_type,resource_id,version,data)
 values($1,$2,$3,$4,$5) on conflict(deployment_id,resource_type,resource_id) do update set version=excluded.version,data=excluded.data
 where namepass_resources.version<excluded.version`,
		[
			event.deploymentId,
			event.resourceType,
			event.resourceId,
			event.resourceVersion,
			event.data,
		],
	);
	// Enqueue your business work in this same transaction. Never send another bank
	// transfer in response to a retry, flow failure or webhook delivery failure.
}
export function receiver(pool, secrets) {
	return createServer(async (req, res) => {
		if (req.method !== "POST" || req.url !== "/namepass") {
			res.writeHead(404).end();
			return;
		}
		let client;
		try {
			const parts = [];
			let size = 0;
			for await (const part of req) {
				size += part.length;
				if (size > 1048576) {
					res.writeHead(413).end();
					return;
				}
				parts.push(part);
			}
			let event;
			try {
				event = verifyWebhook(Buffer.concat(parts), req.headers, secrets);
			} catch {
				res.writeHead(401).end();
				return;
			}
			client = await pool.connect();
			await client.query("begin");
			await saveEvent(client, event);
			await client.query("commit");
			res.writeHead(204).end();
		} catch {
			if (client) await client.query("rollback");
			res.writeHead(503).end();
		} finally {
			client?.release();
		}
	});
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const secrets =
		process.env.NAMEPASS_WEBHOOK_SECRETS?.split(",").filter(Boolean);
	if (!process.env.DATABASE_URL || !secrets?.length)
		throw new Error("Set DATABASE_URL and NAMEPASS_WEBHOOK_SECRETS.");
	receiver(
		new Pool({ connectionString: process.env.DATABASE_URL }),
		secrets,
	).listen(Number(process.env.PORT ?? 8080), "127.0.0.1");
}
