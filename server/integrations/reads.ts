import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { database } from "../db/client";
import { ApiError } from "../http";
import { ACTIVE_ENVIRONMENT } from "../../src/lib/chains";
import { DEPLOYMENT_ID } from "./config";
import { encodeCursor, decodeCursor } from "./crypto";
import { eventEnvelope } from "./journal";
import { query, type Executor } from "./store";
import { name, pageSize, time, uuid } from "./validation";

export type ResourceKind =
	| "name"
	| "deposit"
	| "flow"
	| "settlement"
	| "transfer"
	| "activation"
	| "balance"
	| "consumption"
	| "transaction"
	| "supersession"
	| "evidence"
	| "coverage"
	| "watch";
type Version = {
	resource_kind: ResourceKind;
	resource_id: string;
	revision: string;
	position: string;
	payload: Record<string, unknown>;
};
export function resource(row: Version): Record<string, unknown> & {
	id: string;
	version: string;
	resourceType: ResourceKind;
} {
	return {
		...row.payload,
		id: row.resource_id,
		version: String(row.revision),
		resourceType: row.resource_kind,
		environment: ACTIVE_ENVIRONMENT,
		deploymentId: DEPLOYMENT_ID,
	};
}
async function head(db: Executor) {
	const [row] = await query<{
		position: string;
		minimum_position: string;
		updated_at: Date;
	}>(
		sql`
    select position::text,minimum_position::text,updated_at from integration_publication where id=1`,
		db,
	);
	return row;
}
function visible(partner: string, names?: string[]): SQL {
	const scope = names
		? sql`v.name_id=any(${sql.param(names)}::uuid[])`
		: sql`exists(select 1 from integration_watches w
    where w.partner_id=${partner} and w.name_id=v.name_id and w.enabled)`;
	return sql`(v.partner_id=${partner} or (v.partner_id is null and ${scope}))`;
}
export async function getResource(
	partner: string,
	kind: ResourceKind,
	id: string,
	db: Executor = database(),
) {
	const [row] = await query<Version>(
		sql`select v.resource_kind,v.resource_id,v.revision::text,v.position::text,v.payload
    from integration_versions v where v.resource_kind=${kind} and v.resource_id=${id} and ${visible(partner)}
    order by v.position desc limit 1`,
		db,
	);
	if (!row || row.payload.deleted)
		throw new ApiError(
			404,
			"resource_not_found",
			"The resource is not available to this integration.",
		);
	return resource(row);
}

export async function resolveNameId(
	label: string,
	db: Executor = database(),
): Promise<string> {
	const [row] = await query<{ id: string }>(
		sql`select id from names where normalized_label=${name(label)}`,
		db,
	);
	if (!row)
		throw new ApiError(
			404,
			"name_not_found",
			"This name has not been activated.",
		);
	return row.id;
}

export async function listResources(
	partner: string,
	kind: ResourceKind,
	search: URLSearchParams,
	db: Executor = database(),
) {
	for (const key of search.keys())
		if (
			![
				"limit",
				"cursor",
				"name",
				"chainId",
				"status",
				"txHash",
				"reference",
				"createdFrom",
				"updatedFrom",
			].includes(key)
		)
			throw new ApiError(
				400,
				"invalid_query",
				`Unknown query parameter: ${key}.`,
			);
	const limit = pageSize(search);
	const filterSearch = new URLSearchParams(search);
	filterSearch.delete("cursor");
	filterSearch.delete("limit");
	filterSearch.sort();
	const fingerprint = createHash("sha256")
		.update(filterSearch.toString())
		.digest("hex");
	const cursor = search.get("cursor")
		? decodeCursor(search.get("cursor")!, partner, kind)
		: undefined;
	if (cursor && cursor.filter !== fingerprint)
		throw new ApiError(
			400,
			"invalid_cursor",
			"Do not change filters while paging.",
		);
	const watermark = await head(db),
		position = cursor?.position ?? watermark.position;
	const asOf = cursor?.asOf ?? watermark.updated_at.toISOString();
	if (BigInt(position) < BigInt(watermark.minimum_position))
		throw new ApiError(410, "cursor_expired", "Start this query again.");
	const filters: SQL[] = [
		sql`not coalesce((payload->>'deleted')::boolean,false)`,
	];
	if (search.has("name"))
		filters.push(
			sql`name_id=${await resolveNameId(search.get("name")!, db)}::uuid`,
		);
	if (search.has("chainId"))
		filters.push(
			sql`coalesce(payload->>'chainId',payload->>'originChainId')=${search.get("chainId")}`,
		);
	if (search.has("status"))
		filters.push(
			sql`coalesce(payload->>'status',payload->>'observationStatus')=${search.get("status")}`,
		);
	if (search.has("txHash"))
		filters.push(
			sql`lower(coalesce(payload->>'txHash',payload->>'originTxHash',payload->'evidence'->'hub'->>'txHash'))=${search.get("txHash")!.toLowerCase()}`,
		);
	if (search.has("reference"))
		filters.push(sql`payload->>'reference'=${search.get("reference")}`);
	const created = time(search.get("createdFrom"), "createdFrom"),
		updated = time(search.get("updatedFrom"), "updatedFrom");
	if (created)
		filters.push(
			sql`coalesce(payload->>'createdAt',payload->>'blockTime',payload->>'observedAt')::timestamptz>=${created}::timestamptz`,
		);
	if (updated)
		filters.push(
			sql`position in (select position from integration_events where recorded_at>=${updated}::timestamptz)`,
		);
	const rows = await query<Version>(
		sql`with latest as (
    select v.* from integration_versions v
    where v.resource_kind=${kind} and v.resource_id>${cursor?.after ?? ""} and v.position<=${position} and ${visible(partner)}
    and not exists(select 1 from integration_versions newer where newer.resource_kind=v.resource_kind and newer.resource_id=v.resource_id and newer.position>v.position and newer.position<=${position})
  ) select resource_kind,resource_id,revision::text,position::text,payload from latest
  where resource_id>${cursor?.after ?? ""} and ${sql.join(filters, sql` and `)} order by resource_id limit ${limit + 1}`,
		db,
	);
	const items = rows.slice(0, limit),
		hasMore = rows.length > limit;
	return {
		items: items.map(resource),
		asOf,
		hasMore,
		nextCursor: hasMore
			? encodeCursor({
					partner,
					kind,
					position,
					after: items[items.length - 1]!.resource_id,
					filter: fingerprint,
					asOf,
				})
			: null,
	};
}

export async function createSnapshot(partner: string) {
	return database().transaction(
		async (tx) => {
			const watermark = await head(tx);
			const names = await query<{ name_id: string }>(
				sql`select name_id from integration_watches where partner_id=${partner} and enabled order by name_id`,
				tx,
			);
			const [snapshot] = await query<{ id: string; expires_at: Date }>(
				sql`
      insert into integration_snapshots(partner_id,position,names) values(${partner},${watermark.position},${sql.param(names.map((row) => row.name_id))}::uuid[])
      returning id,expires_at`,
				tx,
			);
			return {
				id: snapshot.id,
				expiresAt: snapshot.expires_at,
				eventsCursor: encodeCursor({
					partner,
					kind: "events",
					position: watermark.position,
				}),
				nextCursor: encodeCursor({
					partner,
					kind: "sync",
					position: watermark.position,
					snapshot: snapshot.id,
					expires: new Date(String(snapshot.expires_at)).getTime(),
				}),
			};
		},
		{ isolationLevel: "repeatable read" },
	);
}
export async function snapshotPage(
	partner: string,
	id: string,
	search: URLSearchParams,
) {
	uuid(id);
	const [snapshot] = await query<{
		position: string;
		names: string[];
		expires_at: Date;
	}>(sql`
    select position::text,names,expires_at from integration_snapshots where id=${id} and partner_id=${partner}`);
	if (!snapshot)
		throw new ApiError(
			404,
			"snapshot_not_found",
			"The snapshot was not found.",
		);
	if (new Date(String(snapshot.expires_at)).getTime() < Date.now())
		throw new ApiError(410, "snapshot_expired", "Create a new sync snapshot.");
	const cursor = search.get("cursor")
		? decodeCursor(search.get("cursor")!, partner, "sync")
		: undefined;
	if (
		cursor &&
		(cursor.snapshot !== id || cursor.position !== snapshot.position)
	)
		throw new ApiError(
			400,
			"invalid_cursor",
			"The cursor belongs to another snapshot.",
		);
	const after: [string, string] = cursor?.after
		? JSON.parse(cursor.after)
		: ["", ""];
	const limit = pageSize(search);
	const rows = await query<Version>(sql`with latest as (
    select v.* from integration_versions v
    where (v.resource_kind,v.resource_id)>(${after[0]},${after[1]}) and v.position<=${snapshot.position} and ${visible(partner, snapshot.names)}
    and not exists(select 1 from integration_versions newer where newer.resource_kind=v.resource_kind and newer.resource_id=v.resource_id and newer.position>v.position and newer.position<=${snapshot.position})
  ) select resource_kind,resource_id,revision::text,position::text,payload from latest
    where (resource_kind,resource_id)>(${after[0]},${after[1]}) and not coalesce((payload->>'deleted')::boolean,false)
    order by resource_kind,resource_id limit ${limit + 1}`);
	const items = rows.slice(0, limit),
		last = items[items.length - 1],
		hasMore = rows.length > limit;
	return {
		items: items.map(resource),
		hasMore,
		nextCursor: hasMore
			? encodeCursor({
					partner,
					kind: "sync",
					position: snapshot.position,
					snapshot: id,
					after: JSON.stringify([last!.resource_kind, last!.resource_id]),
					expires: new Date(String(snapshot.expires_at)).getTime(),
				})
			: null,
		eventsCursor: encodeCursor({
			partner,
			kind: "events",
			position: snapshot.position,
		}),
	};
}

type EventRow = {
	id: string;
	position: string;
	resource_kind: string;
	resource_id: string;
	revision: string;
	payload: Record<string, unknown>;
	event_type: string;
	recorded_at: Date;
	published_at: Date;
};
export async function listEvents(partner: string, search: URLSearchParams) {
	const limit = pageSize(search),
		watermark = await head(database());
	const cursor = search.get("cursor")
		? decodeCursor(search.get("cursor")!, partner, "events")
		: undefined;
	if (cursor && search.has("from"))
		throw new ApiError(
			400,
			"invalid_pagination",
			"Use from or cursor, not both.",
		);
	const from = time(search.get("from"), "from");
	if (from && Date.parse(from) < Date.now() - 90 * 86400000)
		throw new ApiError(
			410,
			"history_expired",
			"Use a sync snapshot for older state.",
		);
	const position = cursor?.position ?? watermark.minimum_position;
	if (BigInt(position) < BigInt(watermark.minimum_position))
		throw new ApiError(410, "cursor_expired", "Create a new sync snapshot.");
	const rows =
		await query<EventRow>(sql`select e.id,e.position::text,e.resource_kind,e.resource_id,e.revision::text,
    e.payload,e.event_type,e.recorded_at,e.published_at from integration_events e
    join integration_audiences a on a.event_position=e.position and a.partner_id=${partner}
    where e.position>${position} and e.position<=${watermark.position}
    ${from ? sql`and e.published_at>=${from}::timestamptz` : sql``}
    order by e.position limit ${limit + 1}`);
	const items = rows.slice(0, limit),
		hasMore = rows.length > limit;
	return {
		items: items.map(eventEnvelope),
		hasMore,
		nextCursor: encodeCursor({
			partner,
			kind: "events",
			position: hasMore
				? items[items.length - 1]!.position
				: watermark.position,
		}),
	};
}
export async function getEvent(partner: string, id: string) {
	uuid(id);
	const [row] =
		await query<EventRow>(sql`select e.* from integration_events e join integration_audiences a
    on a.event_position=e.position where a.partner_id=${partner} and e.id=${id} and e.published_at>=now()-interval '90 days'`);
	if (!row)
		throw new ApiError(
			404,
			"event_not_found",
			"The event is unavailable or expired.",
		);
	return eventEnvelope(row);
}
