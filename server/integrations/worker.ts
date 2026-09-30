import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { ApiError } from "../http";
import { query } from "./store";
import { enqueue } from "./commands";
import { verifyDeposit, verifyFlow, recomputeConsumption } from "./evidence";
import {
	repairCoverage,
	repairTransaction,
	discoverTransaction,
} from "./coverage";
import { enabled } from "./config";

export async function processJob(): Promise<boolean> {
	const lease = crypto.randomUUID();
	const [job] = await query<{
		id: string;
		kind: string;
		input: Record<string, string>;
		attempts: number;
		revision_at: string;
		expired: boolean;
	}>(sql`
    update integration_jobs set status='running',lease_token=${lease},lease_until=now()+interval '5 minutes',attempts=attempts+1
    where id=(select id from integration_jobs where kind<>'dispatcher' and (status='pending' and next_at<=now() or status='running' and lease_until<now())
      order by next_at for update skip locked limit 1) returning *,updated_at::text as revision_at,created_at < now()-interval '30 minutes' as expired`);
	if (!job) return false;
	let failure: string | null = null;
	try {
		if (job.kind === "discover" && job.expired) {
			await database().execute(
				sql`update integration_jobs set status='failed',error_code='discovery_expired',lease_token=null,lease_until=null where id=${job.id} and lease_token=${lease}`,
			);
			return true;
		}
		if (job.kind === "discover")
			await discoverTransaction(job.input.chainId, job.input.txHash);
		else if (job.kind === "flow_evidence") await verifyFlow(job.input.flowId);
		else if (job.kind === "deposit_evidence")
			await verifyDeposit(job.input.depositId);
		else if (job.kind === "coverage")
			await repairCoverage(job.input.nameId, job.input.chainId);
		else if (job.kind === "protocol")
			await repairTransaction(
				job.input.nameId,
				job.input.chainId,
				job.input.txHash,
			);
		else if (job.kind === "consumption")
			await recomputeConsumption(job.input.nameId, job.input.chainId);
		else throw new Error("unknown_job_kind");
	} catch (error) {
		if (
			job.kind === "flow_evidence" &&
			error instanceof ApiError &&
			[
				"receipt_not_canonical",
				"transaction_reverted",
				"evidence_source_changed",
			].includes(error.code)
		) {
			await database().execute(
				sql`update integration_settlements set status='invalidated',finalized_at=null,updated_at=now() where flow_id=${job.input.flowId} and status<>'invalidated'`,
			);
			const [flow] = await query<{ name_id: string; origin_chain_id: string }>(
				sql`select name_id,origin_chain_id::text from flows where id=${job.input.flowId}`,
			);
			if (flow)
				await enqueue(
					database(),
					`consumption:${flow.name_id}:${flow.origin_chain_id}`,
					"consumption",
					{ nameId: flow.name_id, chainId: flow.origin_chain_id },
				);
		}
		if (error instanceof ApiError && error.code === "evidence_source_changed") {
			const [source] = await query<{
				name_id: string | null;
			}>(sql`select coalesce(d.name_id,(select name_id from flows where origin_event_id=c.event_id or renewal_event_id=c.event_id limit 1)) as name_id
        from chain_events c left join deposits d on d.event_id=c.event_id where c.event_id=${String(error.details?.eventId)}`);
			if (source?.name_id)
				await enqueue(
					database(),
					`protocol:${error.details?.chainId}:${error.details?.txHash}:${source.name_id}`,
					"protocol",
					{
						nameId: source.name_id,
						chainId: String(error.details?.chainId),
						txHash: String(error.details?.txHash),
					},
				);
		}
		failure =
			error instanceof ApiError
				? error.code
				: error instanceof Error && /^[a-z_]{1,80}$/.test(error.message)
					? error.message
					: "verification_pending";
	}
	const delay = failure?.startsWith("coverage_")
		? 1
		: Math.min(300, 10 * 2 ** Math.min(job.attempts - 1, 5));
	// A source trigger can enqueue another revision while this lease is working.
	// Preserve that wake instead of marking the newly queued revision done.
	await database()
		.execute(sql`update integration_jobs set status=case when updated_at<>${job.revision_at}::timestamptz or ${failure}::text is not null then 'pending' else 'done' end,
    next_at=case when updated_at<>${job.revision_at}::timestamptz then now() else now()+${delay}*interval '1 second' end,
    lease_token=null,lease_until=null,error_code=${failure}
    where id=${job.id} and lease_token=${lease}`);
	return true;
}

export async function integrationStep(dispatchToken: string): Promise<boolean> {
	if (!enabled() || process.env.NAMEPASS_MAINTENANCE === "1") return false;
	const renewed =
		await query(sql`update integration_jobs set lease_until=now()+interval '10 minutes'
    where key='dispatcher:evidence' and lease_token=${dispatchToken} returning id`);
	if (!renewed.length) return false;
	const results = await Promise.allSettled([processJob(), processJob()]);
	return results.some(
		(result) => result.status === "fulfilled" && result.value,
	);
}
export async function finishIntegrationPump(token: string) {
	await database()
		.execute(sql`update integration_jobs set status='done',lease_until=null
    where key='dispatcher:evidence' and lease_token=${token}`);
}
