import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { requireMonitoringSession } from "../monitoring-auth";
import { ApiError, json, readObject } from "../http";
import { SCOPES } from "./config";
import { newCredential } from "./crypto";
import { query } from "./store";
import * as validate from "./validation";

export async function integrationsAdmin(request: Request): Promise<Response> {
	const session = requireMonitoringSession(request);
	if (request.method === "GET") {
		const [partners, keys, endpoints, metrics, jobs, deliveries] =
			await Promise.all([
				query(
					sql`select id,name,enabled,read_rate as "readRate",write_rate as "writeRate",created_at as "createdAt" from integration_partners order by created_at desc limit 100`,
				),
				query(
					sql`select id,partner_id as "partnerId",prefix,scopes,created_at as "createdAt",revoked_at as "revokedAt" from integration_keys order by created_at desc limit 500`,
				),
				query(
					sql`select id,partner_id as "partnerId",url,status,configuration_version as version from integration_endpoints order by created_at desc limit 500`,
				),
				query(sql`select (select count(*)::int from integration_outbox where not published) as "unpublishedEvents",
        (select min(recorded_at) from integration_outbox where not published) as "oldestUnpublishedAt",
        (select count(*)::int from integration_jobs where status in ('pending','running') and kind<>'dispatcher') as "pendingJobs",
        (select count(*)::int from integration_deliveries where status in ('pending','running')) as "pendingDeliveries",
        (select count(*)::int from integration_deliveries where status in ('paused','exhausted')) as "attentionDeliveries"`),
				query(
					sql`select id,key,kind,status,attempts,next_at as "nextAttemptAt",error_code as "reasonCode" from integration_jobs where status<>'done' and kind<>'dispatcher' order by next_at limit 100`,
				),
				query(
					sql`select id,partner_id as "partnerId",endpoint_id as "endpointId",status,attempts,last_error as "reasonCode",next_at as "nextAttemptAt" from integration_deliveries where status<>'succeeded' order by next_at limit 100`,
				),
			]);
		return json(
			{ partners, keys, endpoints, metrics: metrics[0], jobs, deliveries },
			200,
			{ "cache-control": "private, no-store" },
		);
	}
	if (request.method !== "POST")
		throw new ApiError(405, "method_not_allowed", "Method not allowed.");
	const origin = request.headers.get("origin");
	if (
		!origin ||
		origin !== new URL(request.url).origin ||
		request.headers.get("x-namepass-admin") !== "1"
	)
		throw new ApiError(
			403,
			"invalid_origin",
			"Use the Namepass operator console.",
		);
	const body = await readObject(request, [
		"action",
		"partnerId",
		"keyId",
		"name",
		"scopes",
		"enabled",
		"jobId",
	]);
	const action = validate.string(body.action, "action");
	const result = await database().transaction(async (tx) => {
		let partner = body.partnerId
			? validate.uuid(body.partnerId, "partnerId")
			: null;
		let data: unknown;
		if (action === "create_partner") {
			const [row] = await query<{ id: string }>(
				sql`insert into integration_partners(name) values(${validate.string(body.name, "name", 120)}) returning id`,
				tx,
			);
			partner = row.id;
			data = { partnerId: partner };
		} else if (action === "create_key") {
			if (
				!partner ||
				!Array.isArray(body.scopes) ||
				!body.scopes.length ||
				body.scopes.some((s) => !SCOPES.includes(s as (typeof SCOPES)[number]))
			)
				validate.invalid("scopes");
			const credential = newCredential();
			const [row] = await query<{ id: string }>(
				sql`insert into integration_keys(partner_id,prefix,digest,scopes) values(${partner},${credential.prefix},${credential.digest},${sql.param(body.scopes)}::text[]) returning id`,
				tx,
			);
			data = { id: row.id, apiKey: credential.key };
		} else if (action === "revoke_key") {
			const [row] = await query<{ partner_id: string }>(
				sql`update integration_keys set revoked_at=now() where id=${validate.uuid(body.keyId, "keyId")} returning partner_id`,
				tx,
			);
			if (!row)
				throw new ApiError(404, "key_not_found", "The key was not found.");
			partner = row.partner_id;
			data = { revoked: true };
		} else if (action === "set_partner_enabled") {
			if (!partner || typeof body.enabled !== "boolean")
				validate.invalid("enabled");
			await tx.execute(
				sql`update integration_partners set enabled=${body.enabled} where id=${partner}`,
			);
			data = { partnerId: partner, enabled: body.enabled };
		} else if (action === "retry_job") {
			const rows = await query(
				sql`update integration_jobs set status='pending',next_at=now(),updated_at=now() where id=${validate.uuid(body.jobId, "jobId")} and status<>'running' returning id`,
				tx,
			);
			data = { retried: rows.length === 1 };
		} else validate.invalid("action");
		await tx.execute(
			sql`insert into integration_audit(actor,action,partner_id,resource_id) values(${session.login},${action},${partner},${String(body.keyId ?? body.jobId ?? partner ?? "")})`,
		);
		return data;
	});
	return json(result, 200, { "cache-control": "private, no-store" });
}
