import { wakeIntegrations } from "./wake";
import { checkRateLimit } from "@vercel/firewall";
import { sql } from "drizzle-orm";
import {
	ApiError,
	handler,
	json,
	readObject,
	requiredString,
	pathSegment,
	type Route,
} from "../http";
import { activateName } from "../names";
import { fundingChains, requireEnabled, DEPLOYMENT_ID } from "./config";
import { query } from "./store";
import { chain, hash, invalid } from "./validation";

/** Public blockchain data. OPTIONS and error responses have the same CORS policy. */
export function publicApi(method: "POST" | "GET", run: Route) {
	const route = handler(method, async (request) => {
		requireEnabled();
		if (process.env.VERCEL === "1" || process.env.NAMEPASS_RATE_LIMIT_PREFIX) {
			const path = new URL(request.url).pathname;
			const category =
				method === "GET"
					? "reads"
					: path.endsWith("/address")
						? "address"
						: "quote";
			const prefix =
				process.env.NAMEPASS_RATE_LIMIT_PREFIX ?? "namepass-public";
			const result = await checkRateLimit(`${prefix}-${category}`, {
				request,
			}).catch(() => {
				throw new ApiError(
					503,
					"api_unavailable",
					"The public API is temporarily unavailable.",
				);
			});
			if (result.error)
				throw new ApiError(
					503,
					"api_unavailable",
					"The public API is temporarily unavailable.",
				);
			if (result.rateLimited)
				throw new ApiError(
					429,
					"rate_limited",
					"Too many requests. Retry after the indicated delay.",
				);
		}
		return run(request);
	});
	return {
		async fetch(request: Request) {
			const response =
				request.method === "OPTIONS"
					? new Response(null, { status: 204 })
					: await route.fetch(request);
			const headers = new Headers(response.headers);
			headers.set("access-control-allow-origin", "*");
			headers.set("access-control-allow-methods", `${method}, OPTIONS`);
			headers.set("access-control-allow-headers", "Content-Type");
			headers.set("access-control-expose-headers", "Retry-After");
			headers.set("cache-control", "no-store");
			if ([404, 429, 503].includes(response.status))
				headers.set("retry-after", response.status === 429 ? "60" : "5");
			return new Response(response.body, { status: response.status, headers });
		},
	};
}

export async function addressResponse(request: Request) {
	const body = await readObject(request, ["name"]);
	const result = await activateName(requiredString(body, "name", 512));
	if (!result.name.renewableBy)
		throw new ApiError(
			422,
			"name_not_renewable",
			"This name cannot currently be renewed.",
		);
	return json({
		name: result.name.displayName,
		depositAddress: result.name.depositAddress,
		subname: `${result.name.label}.namepass.eth`,
		subnameVerified:
			process.env.NAMEPASS_ALIAS_VERIFIED_DEPLOYMENT === DEPLOYMENT_ID,
		chains: fundingChains(),
	});
}

type DepositStatusRow = {
	id: string;
	name: string;
	depositAddress: string;
	amount: string;
	logIndex: number | null;
	canonical: boolean;
	verified: boolean;
	completed: boolean;
	reason: string | null;
	renewals: Array<{
		chainId: string;
		transactionHash: string;
		secondsAdded: string;
		expiry: string | null;
	}>;
};

export async function statusResponse(request: Request) {
	const url = new URL(request.url);
	const chainId = pathSegment(request);
	const source = chain(chainId);
	if ([...url.searchParams.keys()].some((key) => key !== "transactionHash"))
		invalid("query");
	if (url.searchParams.getAll("transactionHash").length !== 1)
		invalid("transactionHash");
	const transactionHash = hash(url.searchParams.get("transactionHash"));
	// One stored-data query: polling neither sends a payment nor makes a chain RPC.
	const rows = await query<DepositStatusRow>(sql`
    select d.event_id as id,n.display_name as name,n.deposit_address as "depositAddress",
      d.amount::text as amount,case when d.transfer_kind='native' then null else d.log_index end as "logIndex",
      (ce.canonical and d.status<>'orphaned') as canonical,
      coalesce(e.canonical and e.chain_id=d.chain_id and e.tx_hash=d.tx_hash and e.block_number=d.block_number and e.log_index is not distinct from (case when d.transfer_kind='native' then null else d.log_index end),false) as verified,
      coalesce(c.status='completed' and cardinality(c.flow_ids)>0 and e.canonical and ce.canonical and d.status<>'orphaned'
        and not exists(select 1 from unnest(c.flow_ids) candidate(id)
          left join flows f on f.id=candidate.id
          left join integration_settlements s on s.flow_id=f.id and s.status='finalized'
          left join chain_events origin on origin.event_id=f.origin_event_id
          left join chain_events renewal on renewal.event_id=f.renewal_event_id
          where s.id is null or f.name_id<>d.name_id or s.name_id<>d.name_id or f.status<>'settled'
            or not coalesce(origin.canonical,false) or not coalesce(renewal.canonical,false)),false) as completed,
      c.reason,
      coalesce((select jsonb_agg(jsonb_build_object('chainId',s.evidence->'hub'->>'chainId',
          'transactionHash',s.evidence->'hub'->>'txHash','secondsAdded',s.duration_seconds::text,'expiry',s.expiry_after) order by s.id)
        from integration_settlements s where s.flow_id=any(c.flow_ids) and s.status='finalized'),'[]'::jsonb) as renewals
    from deposits d join names n on n.id=d.name_id join chain_events ce on ce.event_id=d.event_id
    left join integration_evidence e on e.id=d.event_id
    left join integration_consumptions c on c.id=d.event_id
    where d.chain_id=${String(source.chainId)} and d.tx_hash=${transactionHash}
    order by d.log_index,d.event_id`);
	if (!rows.length) {
		// One bounded receipt-discovery job per source transaction closes watchlist propagation gaps.
		// Repeated polls do not reset its lease, retry count or expiry.
		const queued = await query(sql`insert into integration_jobs(key,kind,input)
      values(${`discover:${source.chainId}:${transactionHash}`},'discover',${sql.param(JSON.stringify({ chainId: String(source.chainId), txHash: transactionHash }))}::jsonb)
      on conflict(key) do nothing returning id`);
		if (queued.length) {
			try {
				await wakeIntegrations();
			} catch {
				/* Cron repairs missed starts. */
			}
		}
		throw new ApiError(
			404,
			"deposit_not_found",
			"This transaction has not been indexed as a Namepass deposit. Try again shortly.",
		);
	}
	const deposits = rows.map((row) => {
		const status = !row.canonical
			? "failed"
			: row.verified && row.completed
				? "complete"
				: row.verified
					? "processing"
					: "pending";
		return {
			name: row.name,
			depositAddress: row.depositAddress,
			logIndex: row.logIndex,
			amount: row.amount,
			status,
			reason: !row.canonical ? "transaction_orphaned" : row.reason,
			renewals: status === "complete" ? row.renewals : [],
		};
	});
	const status = deposits.every((d) => d.status === "complete")
		? "complete"
		: deposits.some((d) => d.status === "failed")
			? "failed"
			: deposits.some(
						(d) => d.status === "processing" || d.status === "complete",
				  )
				? "processing"
				: "pending";
	return json(
		{ chainId: String(source.chainId), transactionHash, status, deposits },
		200,
		status === "pending" || status === "processing"
			? { "retry-after": "5" }
			: {},
	);
}
