import { sql } from "drizzle-orm";
import { database } from "./db/client";
import { SERVER_CHAINS } from "../src/lib/chains";
import { stageBudgetMinutes } from "../src/lib/monitoring";
import type { MonitorRead } from "../src/lib/monitoring";

/** One statement gives every panel the same database snapshot. No RPC calls. */
export interface MonitorFilters {
  page?: number;
  chainId?: number;
  search?: string;
  status?: string;
}
export async function monitoring(
  days: number,
  filters: MonitorFilters = {},
): Promise<MonitorRead> {
  const result = await database().execute<{ data: MonitorRead }>(
    monitoringQuery(days, filters),
  );
  return result.rows[0].data;
}

export function monitoringQuery(days: number, filters: MonitorFilters = {}) {
  const review = sql`(status in ('unclaimed','failed') or (status not in ('held','unclaimed','failed') and "stageAt" < now() - (case when status = 'waiting_attestation' then case when "chainId" = ${SERVER_CHAINS.find((c) => c.key === "arc")?.chainId ?? -1} then ${stageBudgetMinutes("waiting_attestation", "arc")} else ${stageBudgetMinutes("waiting_attestation", "base")} end when status in ('waiting_origin','waiting_claim') then ${stageBudgetMinutes("waiting_origin", "ethereum")} else ${stageBudgetMinutes("queued", "ethereum")} end)::int * interval '1 minute'))`;
  const filter = sql`(${filters.chainId ?? null}::numeric is null or "chainId" = ${filters.chainId ?? null}::numeric)
  and strpos(lower(name), lower(${filters.search ?? ""})) > 0
  and (${filters.status ?? "all"} = 'all' or (${filters.status ?? "all"} = 'attention' and ${review})
   or (${filters.status ?? "all"} = 'active' and status not in ('held','unclaimed','failed')) or status::text = ${filters.status ?? "all"})`;
  return sql`
 with renewal as (
  select * from chain_events where canonical and event_family = 'namepass' and event_type = 'Renewed'
 ), inbound as (
  select d.* from deposits d join chain_events e on e.event_id = d.event_id
  where e.canonical and d.status <> 'orphaned'
 ), open_flows as (
  select f.id, n.display_name as name, f.origin_chain_id::float8 as "chainId", f.status,
   coalesce(f.amount_processed, f.amount_detected)::text as amount,
   coalesce(case f.status
    when 'queued' then f.queued_at when 'confirming_deposit' then f.confirming_deposit_at
    when 'checking_name' then f.checking_name_at when 'submitting_origin' then f.submitting_origin_at
    when 'waiting_origin' then f.waiting_origin_at when 'waiting_attestation' then f.waiting_attestation_at
    when 'submitting_claim' then f.submitting_claim_at when 'waiting_claim' then f.waiting_claim_at
    when 'held' then f.held_at when 'unclaimed' then f.unclaimed_at when 'failed' then f.failed_at
   end, f.created_at) as "stageAt",
   f.next_action_at as "nextActionAt", coalesce(f.last_error_code, f.hold_reason) as reason,
   f.origin_evidence_tx_hash as "txHash"
  from flows f join names n on n.id = f.name_id where f.status not in ('settled', 'cancelled')
 ), days as (
  select generate_series((now() at time zone 'UTC')::date - (${days}::int - 1),
   (now() at time zone 'UTC')::date, interval '1 day')::date as day
 )
 select json_build_object(
  'generatedAt', now(),
  'totals', json_build_object(
   'names', (select count(*)::text from names),
   'depositors', (select count(distinct lower(sender_address))::text from inbound where sender_address is not null),
   'deposits', (select count(*)::text from inbound),
   'depositVolume', (select coalesce(sum(amount),0)::text from inbound),
   'renewals', (select count(*)::text from renewal),
   'received', (select coalesce(sum((facts->>'amount_received')::numeric),0)::text from renewal),
   'applied', (select coalesce(sum((facts->>'amount_applied')::numeric),0)::text from renewal),
   'seconds', (select coalesce(sum((facts->>'duration')::numeric),0)::text from renewal),
   'scans', (select count(*)::text from balance_scan_requests),
   'expiring', (select count(*)::text from names where current_expiry between now() and now() + interval '30 days')
  ),
  'states', (select coalesce(json_agg(s),'[]'::json) from (
   select status, count(*)::text as count, coalesce(sum(coalesce(amount_processed,amount_detected)),0)::text as amount from flows group by status
  ) s),
  'daily', (select coalesce(json_agg(d order by d.day),'[]'::json) from (
   select to_char(days.day, 'YYYY-MM-DD') as day,
    (select count(*)::int from renewal r where (r.block_time at time zone 'UTC')::date = days.day) as renewals,
    (select coalesce(sum((r.facts->>'amount_received')::numeric),0)::text from renewal r where (r.block_time at time zone 'UTC')::date = days.day) as received,
    (select count(*)::int from inbound i where (i.block_time at time zone 'UTC')::date = days.day) as deposits
   from days
  ) d),
  'chains', (select coalesce(json_agg(c),'[]'::json) from (
   select i.chain_id::float8 as "chainId",
    (select count(*)::text from inbound d where d.chain_id = i.chain_id) as deposits,
    (select coalesce(sum(amount),0)::text from inbound d where d.chain_id = i.chain_id) as volume,
    (select max(block_time) from chain_events e where e.canonical and e.chain_id = i.chain_id) as "lastEventAt",
    (select percentile_cont(0.95) within group (order by greatest(0,extract(epoch from (first_seen_at - block_time))))
     from chain_events e where e.canonical and e.chain_id = i.chain_id and e.first_seen_at >= now() - interval '24 hours') as "ingestionP95"
   from (select distinct chain_id from chain_events where canonical) i
  ) c),
  'reviewCount', (select count(*)::text from open_flows where ${review}),
  'matchingFlowCount', (select count(*)::text from open_flows where ${filter}),
  'flowCount', (select count(*)::text from open_flows),
  'flows', (select coalesce(json_agg(f),'[]'::json) from (
   select * from open_flows where ${filter} order by case when status in ('unclaimed','failed') then 0 when status = 'held' then 2 else 1 end, "stageAt", id limit 50 offset ${((filters.page ?? 1) - 1) * 50}
  ) f),
  'latency', (select coalesce(json_agg(l),'[]'::json) from (
   select f.origin_chain_id::float8 as "chainId", count(*)::int as samples,
    percentile_cont(0.5) within group (order by extract(epoch from (r.block_time - d.block_time))) as p50,
    percentile_cont(0.95) within group (order by extract(epoch from (r.block_time - d.block_time))) as p95
   from flows f join renewal r on r.event_id = f.renewal_event_id join inbound d on d.event_id = f.deposit_event_id
   where (r.block_time at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - (${days}::int - 1) and r.block_time >= d.block_time
   group by f.origin_chain_id
  ) l),
  'intents', (select coalesce(json_agg(t),'[]'::json) from (
   select chain_id::float8 as "chainId", count(*)::text as pending,
    count(*) filter (where pending_warned_at is not null)::text as warned
   from transaction_intents where status in ('prepared','broadcast') group by chain_id
  ) t)
 ) as data
 `;
}
