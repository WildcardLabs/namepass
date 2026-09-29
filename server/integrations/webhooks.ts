import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { ApiError } from "../http";
import { ACTIVE_ENVIRONMENT } from "../../src/lib/chains";
import { API_VERSION, DEPLOYMENT_ID, EVENT_TYPES } from "./config";
import { newSigningSecret, encrypt, decrypt, webhookSignature } from "./crypto";
import { endpointUrl, sendWebhook } from "./webhook-network";
import { query, type Executor } from "./store";
import type { Context } from "./http";
import { managementPage, managementCursor } from "./pagination";
import * as validate from "./validation";

type Endpoint = {
	id: string;
	partner_id: string;
	url: string;
	status: string;
	configuration_version: number;
	event_types: string[];
	secret_ciphertext: string;
	previous_secret_ciphertext: string | null;
	previous_secret_until: Date | null;
};
function publicEndpoint(ep: Endpoint) {
	return {
		id: ep.id,
		url: ep.url,
		status: ep.status,
		configurationVersion: ep.configuration_version,
		eventTypes: ep.event_types,
	};
}
function eventTypes(value: unknown): string[] {
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.length > 50 ||
		value.some((v) => typeof v !== "string" || !EVENT_TYPES.includes(v))
	)
		validate.invalid("eventTypes");
	return [...new Set(value as string[])];
}
async function endpoint(
	db: Executor,
	partner: string,
	id: string,
): Promise<Endpoint> {
	validate.uuid(id);
	const [row] = await query<Endpoint>(
		sql`select * from integration_endpoints where id=${id} and partner_id=${partner}`,
		db,
	);
	if (!row)
		throw new ApiError(
			404,
			"endpoint_not_found",
			"The endpoint was not found.",
		);
	return row;
}
export async function listEndpoints(context: Context) {
	const rows = await query<Endpoint>(
		sql`select * from integration_endpoints where partner_id=${context.partner.id} order by created_at`,
		context.db,
	);
	return { body: { items: rows.map(publicEndpoint) } };
}
export async function createEndpoint(context: Context) {
	validate.fields(context.body, ["url", "eventTypes"]);
	await context.db.execute(
		sql`select id from integration_partners where id=${context.partner.id} for update`,
	);
	const [count] = await query<{ total: number }>(
		sql`select count(*)::int as total from integration_endpoints where partner_id=${context.partner.id}`,
		context.db,
	);
	if (count.total >= 5)
		throw new ApiError(
			409,
			"endpoint_limit",
			"Each integration supports five endpoints.",
		);
	const secret = newSigningSecret();
	const [row] = await query<Endpoint>(
		sql`insert into integration_endpoints(partner_id,url,event_types,secret_ciphertext)
    values(${context.partner.id},${endpointUrl(context.body.url)},${sql.param(eventTypes(context.body.eventTypes))}::text[],${encrypt(secret)}) returning *`,
		context.db,
	);
	return {
		status: 201,
		body: { ...publicEndpoint(row), signingSecret: secret },
	};
}
export async function getEndpoint(context: Context, id: string) {
	return {
		body: publicEndpoint(await endpoint(context.db, context.partner.id, id)),
	};
}
export async function editEndpoint(context: Context, id: string) {
	validate.fields(context.body, ["url", "eventTypes", "enabled"]);
	const old = await endpoint(context.db, context.partner.id, id);
	if (
		context.body.enabled !== undefined &&
		typeof context.body.enabled !== "boolean"
	)
		validate.invalid("enabled");
	const url =
		context.body.url === undefined ? old.url : endpointUrl(context.body.url);
	const status =
		context.body.enabled === false
			? "disabled"
			: url !== old.url || old.status === "disabled"
				? "unverified"
				: old.status;
	const [row] = await query<Endpoint>(
		sql`update integration_endpoints set url=${url},event_types=${sql.param(context.body.eventTypes === undefined ? old.event_types : eventTypes(context.body.eventTypes))}::text[],
    status=${status},configuration_version=configuration_version+1,updated_at=now() where id=${id} and partner_id=${context.partner.id} returning *`,
		context.db,
	);
	await context.db.execute(
		sql`update integration_deliveries set status='paused',last_error='endpoint_changed',updated_at=now() where endpoint_id=${id} and status in ('pending','running')`,
	);
	return { body: publicEndpoint(row) };
}
export async function rotateSecret(context: Context, id: string) {
	validate.fields(context.body, []);
	await endpoint(context.db, context.partner.id, id);
	const secret = newSigningSecret();
	const changed = await query(
		sql`update integration_endpoints set previous_secret_ciphertext=secret_ciphertext,previous_secret_until=now()+interval '24 hours',
    secret_ciphertext=${encrypt(secret)},updated_at=now() where id=${id} and partner_id=${context.partner.id}
    and (previous_secret_until is null or previous_secret_until<=now()) returning id`,
		context.db,
	);
	if (!changed.length)
		throw new ApiError(
			409,
			"rotation_in_progress",
			"The previous secret remains valid for its 24-hour overlap. Wait before rotating again.",
		);
	return {
		body: {
			id,
			signingSecret: secret,
			previousSecretExpiresAt: new Date(Date.now() + 86400000).toISOString(),
		},
	};
}
export async function testEndpoint(
	context: Context,
	id: string,
	verify: boolean,
) {
	validate.fields(context.body, []);
	const ep = await endpoint(context.db, context.partner.id, id);
	if (ep.status === "disabled")
		throw new ApiError(
			409,
			"endpoint_disabled",
			"Enable the endpoint before testing it.",
		);
	const eventId = crypto.randomUUID();
	const body = JSON.stringify({
		id: eventId,
		type: verify ? "endpoint.verification" : "endpoint.test",
		apiVersion: API_VERSION,
		environment: ACTIVE_ENVIRONMENT,
		deploymentId: DEPLOYMENT_ID,
		publishedAt: new Date().toISOString(),
		data: { endpointId: id, configurationVersion: ep.configuration_version },
	});
	const [row] = await query<{ id: string }>(
		sql`insert into integration_deliveries(endpoint_id,partner_id,event_id,body,configuration_version)
    values(${id},${context.partner.id},${eventId},${body},${ep.configuration_version}) returning id`,
		context.db,
	);
	return { status: 202, body: { deliveryId: row.id } };
}
export async function deliveries(context: Context, id?: string) {
	const page = managementPage(context.partner.id, "deliveries", context.search),
		{ limit } = page;
	if (id) validate.uuid(id);
	const rows = await query(
		sql`select id,endpoint_id as "endpointId",event_id as "eventId",status,attempts,next_at as "nextAttemptAt",last_error as "reasonCode",created_at as "createdAt"
    from integration_deliveries where partner_id=${context.partner.id} ${id ? sql`and id=${id}` : sql``}
    ${page.after ? sql`and id>${validate.uuid(page.after)}` : sql``} and created_at<=to_timestamp(${page.through}::numeric/1000) order by id limit ${limit + 1}`,
		context.db,
	);
	if (id) {
		if (!rows[0])
			throw new ApiError(
				404,
				"delivery_not_found",
				"The delivery was not found.",
			);
		const attempts = await query(
			sql`select attempted_at as "attemptedAt",http_status as "httpStatus",duration_ms as "durationMs",error_code as "reasonCode"
      from integration_delivery_attempts where delivery_id=${id} order by id desc limit 100`,
			context.db,
		);
		return { body: { ...rows[0], attemptHistory: attempts } };
	}
	return {
		body: {
			items: rows.slice(0, limit),
			hasMore: rows.length > limit,
			nextCursor: managementCursor(
				context.partner.id,
				"deliveries",
				page,
				rows.length > limit ? String(rows[limit - 1].id) : null,
			),
		},
	};
}
export async function replayDelivery(context: Context, id: string) {
	validate.uuid(id);
	validate.fields(context.body, []);
	const rows = await query(
		sql`update integration_deliveries d set status='pending',next_at=now(),retry_until=now()+interval '72 hours',
    configuration_version=ep.configuration_version,lease_token=null,lease_until=null,updated_at=now()
    from integration_endpoints ep where d.endpoint_id=ep.id and d.id=${id} and d.partner_id=${context.partner.id} and ep.status='active' and d.status<>'running' returning d.id`,
		context.db,
	);
	if (!rows.length)
		throw new ApiError(
			409,
			"delivery_not_replayable",
			"The delivery is unavailable, running, or its endpoint is inactive.",
		);
	return { status: 202, body: { deliveryId: id } };
}

export async function deliverOne(
	transport: typeof sendWebhook = sendWebhook,
): Promise<boolean> {
	const lease = crypto.randomUUID();
	const [row] = await query<{
		id: string;
		endpoint_id: string;
		body: string;
		event_id: string;
		configuration_version: number;
		attempts: number;
		retry_until: Date;
	}>(sql`
    update integration_deliveries set status='running',lease_token=${lease},lease_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now()
    where id=(select d.id from integration_deliveries d join integration_partners p on p.id=d.partner_id and p.enabled
      where (d.status='pending' and d.next_at<=now() or d.status='running' and d.lease_until<now())
      order by d.next_at for update of d skip locked limit 1) returning *`);
	if (!row) return false;
	const [ep] = await query<Endpoint>(
		sql`select * from integration_endpoints where id=${row.endpoint_id}`,
	);
	const synthetic =
		JSON.parse(row.body).type === "endpoint.verification" ||
		JSON.parse(row.body).type === "endpoint.test";
	if (
		ep.status === "disabled" ||
		(!synthetic && ep.status !== "active") ||
		ep.configuration_version !== row.configuration_version ||
		new Date(String(row.retry_until)).getTime() < Date.now()
	) {
		await database()
			.execute(sql`update integration_deliveries set status=${new Date(String(row.retry_until)).getTime() < Date.now() ? "exhausted" : "paused"},last_error='endpoint_or_retry_window_changed',updated_at=now()
      where id=${row.id} and lease_token=${lease} and status='running'`);
		return true;
	}
	const now = Math.floor(Date.now() / 1000),
		signatures = [
			webhookSignature(
				row.body,
				row.event_id,
				now,
				decrypt(ep.secret_ciphertext),
			),
		];
	if (
		ep.previous_secret_ciphertext &&
		ep.previous_secret_until &&
		new Date(String(ep.previous_secret_until)).getTime() > Date.now()
	)
		signatures.push(
			webhookSignature(
				row.body,
				row.event_id,
				now,
				decrypt(ep.previous_secret_ciphertext),
			),
		);
	let status: number | null = null,
		error: string | null = null,
		retryAfter: number | null = null;
	const started = Date.now();
	try {
		const result = await transport(ep.url, row.body, {
			"webhook-id": row.event_id,
			"webhook-timestamp": String(now),
			"webhook-signature": signatures.join(" "),
			"namepass-delivery-id": row.id,
		});
		status = result.status;
		retryAfter = result.retryAfter;
	} catch {
		error = "network_or_destination_error";
	}
	const succeeded = status !== null && status >= 200 && status < 300;
	const pause =
		(status !== null &&
			status >= 400 &&
			status < 500 &&
			status !== 408 &&
			status !== 429) ||
		(status !== null && status >= 300 && status < 400);
	const delays = [10, 60, 300, 1800, 7200, 21600],
		delay = Math.max(
			retryAfter ?? 0,
			delays[Math.min(row.attempts - 1, delays.length - 1)],
		);
	await database().transaction(async (tx) => {
		await tx.execute(
			sql`insert into integration_delivery_attempts(delivery_id,http_status,duration_ms,error_code) values(${row.id},${status},${Date.now() - started},${error})`,
		);
		const updated = await query(
			sql`update integration_deliveries set status=${succeeded ? "succeeded" : pause ? "paused" : "pending"},next_at=now()+${delay}*interval '1 second',
      last_error=${succeeded ? null : (error ?? `http_${status}`)},lease_token=null,lease_until=null,updated_at=now()
      where id=${row.id} and lease_token=${lease} and status='running' returning id`,
			tx,
		);
		if (
			updated.length &&
			succeeded &&
			JSON.parse(row.body).type === "endpoint.verification"
		) {
			await tx.execute(
				sql`update integration_endpoints set status='active',updated_at=now() where id=${ep.id} and configuration_version=${row.configuration_version} and status='unverified'`,
			);
		}
	});
	return true;
}
