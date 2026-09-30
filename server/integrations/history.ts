import { sql } from "drizzle-orm";
import { HUB_CHAIN } from "../../src/lib/chains";
import { normalizedLabel } from "../names";
import {
	ApiError,
	activityCursor,
	activityPageInput,
	json,
	pathSegment,
} from "../http";
import { query } from "./store";
import { invalid } from "./validation";

/** A name-filtered history view. Cursor values never change the name predicate. */
export async function historyResponse(request: Request) {
	const name = normalizedLabel(pathSegment(request, "renewals"));
	const search = new URL(request.url).searchParams;
	for (const key of search.keys())
		if (!["limit", "cursor"].includes(key) || search.getAll(key).length !== 1)
			invalid(key);
	const { limit, cursor } = activityPageInput(request);
	const [stored] = await query<{
		id: string;
		display_name: string;
		current_expiry: Date | null;
		ens_synced_at: Date | null;
	}>(
		sql`select id,display_name,current_expiry,ens_synced_at from names where normalized_label=${name}`,
	);
	if (!stored)
		throw new ApiError(
			404,
			"name_not_found",
			"Get a deposit address to activate this name first.",
		);
	const rows = await query<{
		event_id: string;
		block_time: Date;
		flowId: string;
		sourceChainId: string;
		transactionHash: string;
		secondsAdded: string | null;
		amountApplied: string | null;
		renewalFee: string | null;
		expiry: string | null;
		status: string;
	}>(sql`
  select e.event_id,e.block_time,f.id as "flowId",f.origin_chain_id::text as "sourceChainId",e.tx_hash as "transactionHash",
   coalesce(s.duration_seconds::text,e.facts->>'duration') as "secondsAdded",
   coalesce(s.amounts->>'amountApplied',e.facts->>'amount_applied') as "amountApplied",
   coalesce(s.amounts->>'executorAllowance',e.facts->>'gas_allowance') as "renewalFee",
   coalesce(s.expiry_after,f.expiry_after)::text as expiry,
   case when s.status='finalized' and f.status='settled' and origin.canonical then 'complete' else 'processing' end as status
  from flows f join chain_events e on e.event_id=f.renewal_event_id
  left join chain_events origin on origin.event_id=f.origin_event_id
  left join integration_settlements s on s.flow_id=f.id and s.status<>'invalidated'
  where f.name_id=${stored.id} and e.canonical and e.event_type='Renewed' and e.event_family='namepass' and e.chain_id=${String(HUB_CHAIN.chainId)}
   ${cursor ? sql`and (e.block_time,e.event_id)<(${cursor.blockTime},${cursor.eventId})` : sql``}
  order by e.block_time desc,e.event_id desc limit ${limit + 1}`);
	const page = rows.slice(0, limit),
		last = page[page.length - 1];
	return json({
		name: stored.display_name,
		currentExpiry: stored.current_expiry,
		expiryUpdatedAt: stored.ens_synced_at,
		items: page.map((row) => ({
			flowId: row.flowId,
			sourceChainId: row.sourceChainId,
			chainId: String(HUB_CHAIN.chainId),
			transactionHash: row.transactionHash,
			secondsAdded: row.secondsAdded,
			amountApplied: row.amountApplied,
			renewalFee: row.renewalFee,
			expiry: row.expiry ? new Date(row.expiry).toISOString() : null,
			status: row.status,
			renewedAt: row.block_time,
		})),
		nextCursor:
			rows.length > limit && last
				? activityCursor({ blockTime: last.block_time, eventId: last.event_id })
				: null,
	});
}
