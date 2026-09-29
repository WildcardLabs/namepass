import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { query, jsonValue, type Executor } from "./store";
import { ACTIVE_ENVIRONMENT } from "../../src/lib/chains";
import { API_VERSION, DEPLOYMENT_ID } from "./config";

type Outbox = {
	id: string;
	resource_kind: string;
	resource_id: string;
	revision: string;
	name_id: string | null;
	partner_id: string | null;
	payload: Record<string, unknown>;
	event_type: string;
	recorded_at: Date;
};

export function eventEnvelope(row: {
	id: string;
	resource_kind: string;
	resource_id: string;
	revision: string;
	payload: Record<string, unknown>;
	event_type: string;
	recorded_at: Date;
	published_at: Date;
}) {
	return {
		id: row.id,
		type: row.event_type,
		apiVersion: API_VERSION,
		environment: ACTIVE_ENVIRONMENT,
		deploymentId: DEPLOYMENT_ID,
		resourceType: row.resource_kind,
		resourceId: row.resource_id,
		resourceVersion: String(row.revision),
		recordedAt: row.recorded_at,
		publishedAt: row.published_at,
		data: {
			...row.payload,
			environment: ACTIVE_ENVIRONMENT,
			deploymentId: DEPLOYMENT_ID,
		},
	};
}

/** Caller owns the transaction. The row lock serializes publication, never payment writers. */
export async function publishBatch(tx: Executor, limit = 100): Promise<number> {
	if (!Number.isInteger(limit) || limit < 1 || limit > 500)
		throw new Error("Invalid publication batch size.");
	const [head] = await query<{
		position: string;
		deployment_id: string | null;
	}>(
		sql`
    select position::text, deployment_id from integration_publication where id=1 for update`,
		tx,
	);
	if (head.deployment_id && head.deployment_id !== DEPLOYMENT_ID)
		throw new Error("Integration deployment does not match this database.");
	const rows = await query<Outbox>(
		sql`
    select id::text,resource_kind,resource_id,revision::text,name_id,partner_id,payload,event_type,recorded_at
    from integration_outbox where not published order by id limit ${limit}`,
		tx,
	);
	let position = BigInt(head.position);
	for (const row of rows) {
		position++;
		// Per-source rows serialize revisions. IDs are only a batch preference, never a watermark.
		const [event] = await query<{ id: string; published_at: Date }>(
			sql`
      insert into integration_events(position,resource_kind,resource_id,revision,name_id,partner_id,payload,event_type,recorded_at)
      values(${position.toString()},${row.resource_kind},${row.resource_id},${row.revision},${row.name_id},${row.partner_id},
        ${jsonValue(row.payload)},${row.event_type},${row.recorded_at}) returning id,published_at`,
			tx,
		);
		await tx.execute(sql`insert into integration_versions(resource_kind,resource_id,position,revision,name_id,partner_id,payload)
      values(${row.resource_kind},${row.resource_id},${position.toString()},${row.revision},${row.name_id},${row.partner_id},${jsonValue(row.payload)})`);
		await tx.execute(sql`insert into integration_audiences(event_position,partner_id)
      select ${position.toString()}, p.id from integration_partners p where p.enabled and
      (p.id=${row.partner_id}::uuid or (${row.partner_id}::uuid is null and exists(
        select 1 from integration_watches w where w.partner_id=p.id and w.name_id=${row.name_id}::uuid and w.enabled)))`);
		const body = JSON.stringify(eventEnvelope({ ...row, ...event }));
		await tx.execute(sql`insert into integration_deliveries(endpoint_id,partner_id,event_id,event_position,body,configuration_version)
      select ep.id,ep.partner_id,${event.id},${position.toString()},${body},ep.configuration_version
      from integration_endpoints ep join integration_audiences a on a.partner_id=ep.partner_id
      where a.event_position=${position.toString()} and ep.status='active'
      and (cardinality(ep.event_types)=0 or ${row.event_type}=any(ep.event_types)) on conflict do nothing`);
		await tx.execute(
			sql`update integration_outbox set published=true where id=${row.id}`,
		);
	}
	await tx.execute(
		sql`update integration_publication set position=${position.toString()},deployment_id=${DEPLOYMENT_ID},updated_at=clock_timestamp() where id=1`,
	);
	return rows.length;
}
export async function publishChanges(limit = 100): Promise<number> {
	return database().transaction((tx) => publishBatch(tx, limit));
}
