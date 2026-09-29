import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { query } from "./store";
import { enabled } from "./config";

/** Keep a baseline per resource, plus every version reachable by a live cursor. */
export async function retainIntegrations() {
	if (!enabled()) return;
	await database().transaction(async (tx) => {
		await tx.execute(
			sql`select position from integration_publication where id=1 for update`,
		);
		await tx.execute(
			sql`delete from integration_snapshots where expires_at<now()`,
		);
		await tx.execute(
			sql`delete from integration_idempotency where expires_at<now()`,
		);
		const [floor] = await query<{ position: string }>(
			sql`select least(
      coalesce((select max(position) from integration_events where published_at<now()-interval '90 days'),0),
      coalesce((select min(position) from integration_snapshots),9223372036854775807))::text as position`,
			tx,
		);
		await tx.execute(
			sql`update integration_publication set minimum_position=greatest(minimum_position,${floor.position}) where id=1`,
		);
		await tx.execute(sql`delete from integration_versions where (resource_kind,resource_id,position) in (
      select v.resource_kind,v.resource_id,v.position from integration_versions v where v.position<${floor.position}
      and exists(select 1 from integration_versions newer where newer.resource_kind=v.resource_kind and newer.resource_id=v.resource_id
        and newer.position>v.position and newer.position<=${floor.position}) limit 5000)`);
		await tx.execute(
			sql`delete from integration_delivery_attempts where delivery_id in (select id from integration_deliveries where created_at<now()-interval '90 days' and status<>'running' limit 1000)`,
		);
		await tx.execute(sql`delete from integration_deliveries where id in(select d.id from integration_deliveries d where created_at<now()-interval '90 days' and status<>'running'
      and not exists(select 1 from integration_delivery_attempts a where a.delivery_id=d.id) limit 1000)`);
		await tx.execute(sql`delete from integration_events where position in(select e.position from integration_events e where e.position<${floor.position}
      and not exists(select 1 from integration_versions v where v.position=e.position)
      and not exists(select 1 from integration_deliveries d where d.event_position=e.position) limit 5000)`);
		await tx.execute(
			sql`delete from integration_outbox where id in(select id from integration_outbox where published and recorded_at<now()-interval '7 days' limit 5000)`,
		);
		await tx.execute(
			sql`update integration_endpoints set previous_secret_ciphertext=null,previous_secret_until=null where previous_secret_until<now()`,
		);
	});
}
