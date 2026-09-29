import { and, eq, sql } from "drizzle-orm";
import { database } from "../db/client";
import { flows, names } from "../db/schema";
import { activateName } from "../names";
import { recheckHeldNameFlow } from "../operations";
import { readEnsState } from "../chain";
import { startRenewalWorkflow } from "../workflows";
import { queueStoppedFlow } from "../stopped-flows";
import { verifiedChainClient } from "../transactions";
import { parseAbi, type Address } from "viem";
import { SERVER_CHAINS, chainById } from "../../src/lib/chains";
import { ApiError } from "../http";
import { query, jsonValue } from "./store";
import { enqueue } from "./commands";
import {
	verifyTransfer,
	verifyDeposit,
	verifyFlow,
	recomputeConsumption,
} from "./evidence";
import { repairCoverage, repairTransaction } from "./coverage";
import { publishChanges } from "./journal";
import { deliverOne } from "./webhooks";
import { enabled } from "./config";

async function runOperation(id: string) {
	const [op] = await query<{
		kind: string;
		name_id: string;
		input: { name?: string; flowId?: string };
		status: string;
	}>(sql`select * from integration_operations where id=${id}`);
	if (!op || op.status === "succeeded" || op.status === "failed") return;
	await database().execute(
		sql`update integration_operations set status='running',updated_at=now() where id=${id}`,
	);
	let result: unknown;
	if (op.kind === "activation" || op.kind === "refresh") {
		// Persist anchors before the balance read; later repair covers watch propagation.
		for (const chain of SERVER_CHAINS) {
			const tip = await (
				await verifiedChainClient(chainById(chain.chainId)!)
			).getBlockNumber();
			await database().execute(
				sql`insert into integration_coverage(name_id,chain_id,from_block,native_from) values(${op.name_id},${String(chain.chainId)},${(tip > 12n ? tip - 12n : 0n).toString()},${chain.key === "arc" ? (tip > 12n ? tip - 12n : 0n).toString() : null}) on conflict do nothing`,
			);
			await enqueue(
				database(),
				`coverage:${op.name_id}:${chain.chainId}`,
				"coverage",
				{ nameId: op.name_id, chainId: String(chain.chainId) },
			);
		}
		const activated = await activateName(op.input.name!);
		if (activated.balances.some((b) => b.amount === undefined))
			throw new Error("activation_scan_pending");
		result = {
			nameId: op.name_id,
			status: "ready",
			historyCoverage: "reconciling",
		};
	} else if (op.kind === "retry") {
		const [flow] = await database()
			.select()
			.from(flows)
			.where(eq(flows.id, op.input.flowId!));
		if (!flow)
			throw new ApiError(404, "flow_not_found", "The flow was not found.");
		if (flow.status === "held") {
			if (flow.holdReason !== "name_not_renewable")
				throw new ApiError(
					409,
					"flow_not_retryable",
					"This hold requires balance or operator reconciliation.",
				);
			const [name] = await database()
				.select()
				.from(names)
				.where(eq(names.id, flow.nameId));
			await recheckHeldNameFlow(
				flow.id,
				await readEnsState(name.normalizedLabel),
			);
		} else if (flow.status === "failed" || flow.status === "cancelled") {
			if (
				flow.lastErrorCode !== "empty_wallet" ||
				flow.originTxIntentId ||
				flow.originEventId
			)
				throw new ApiError(
					409,
					"flow_not_retryable",
					"This flow requires operator reconciliation.",
				);
			const [name] = await database()
				.select()
				.from(names)
				.where(eq(names.id, flow.nameId));
			const chain = chainById(Number(flow.originChainId))!;
			const balance = await (
				await verifiedChainClient(chain)
			).readContract({
				address: chain.usdcAddress as Address,
				abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
				functionName: "balanceOf",
				args: [name.depositAddress as Address],
			});
			if (balance !== BigInt(flow.amountDetected))
				throw new ApiError(
					409,
					"flow_balance_changed",
					"The wallet balance changed; reconcile this flow before retrying it.",
				);
			if (!(await queueStoppedFlow(flow, "api")))
				throw new ApiError(
					409,
					"flow_changed",
					"The flow changed during retry.",
				);
			await startRenewalWorkflow(flow.id);
		} else if (flow.status !== "settled") {
			if (flow.status === "unclaimed")
				await database()
					.update(flows)
					.set({ nextActionAt: null })
					.where(and(eq(flows.id, flow.id), eq(flows.status, "unclaimed")));
			await startRenewalWorkflow(flow.id);
		}
		result = { flowId: flow.id };
	} else
		throw new ApiError(
			422,
			"operation_not_supported",
			"Unsupported operation.",
		);
	await database().execute(
		sql`update integration_operations set status='succeeded',result=${jsonValue(result)},error_code=null,updated_at=now() where id=${id}`,
	);
}
export async function processJob(): Promise<boolean> {
	const lease = crypto.randomUUID();
	const [job] = await query<{
		id: string;
		kind: string;
		input: Record<string, string>;
		attempts: number;
		revision_at: string;
	}>(sql`
    update integration_jobs set status='running',lease_token=${lease},lease_until=now()+interval '5 minutes',attempts=attempts+1
    where id=(select id from integration_jobs where kind<>'dispatcher' and (status='pending' and next_at<=now() or status='running' and lease_until<now())
      order by next_at for update skip locked limit 1) returning *,updated_at::text as revision_at`);
	if (!job) return false;
	let failure: string | null = null;
	try {
		if (job.kind === "operation") await runOperation(job.input.operationId);
		else if (job.kind === "transfer")
			await verifyTransfer(job.input.transferId);
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
		if (
			error instanceof ApiError &&
			job.kind === "operation" &&
			error.status >= 400 &&
			error.status < 500
		) {
			await database().execute(
				sql`update integration_operations set status='failed',error_code=${error.code},updated_at=now() where id=${job.input.operationId}`,
			);
			failure = null;
		}
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

export type IntegrationRole = "publication" | "evidence" | "delivery";
export async function integrationStep(
	dispatchToken: string,
	role: IntegrationRole,
): Promise<boolean> {
	if (!enabled() || process.env.NAMEPASS_MAINTENANCE === "1") return false;
	const renewed = await query(
		sql`update integration_jobs set lease_until=now()+interval '10 minutes' where key=${`dispatcher:${role}`} and lease_token=${dispatchToken} returning id`,
	);
	if (!renewed.length) return false;
	if (role === "publication") return (await publishChanges(100)) > 0;
	if (role === "evidence") {
		const results = await Promise.allSettled([processJob(), processJob()]);
		return results.some(
			(result) => result.status === "fulfilled" && result.value,
		);
	}
	const deadline = Date.now() + 15000;
	const results = await Promise.allSettled(
		Array.from({ length: 16 }, async () => {
			let count = 0;
			while (Date.now() < deadline && count < 100) {
				if (!(await deliverOne())) break;
				count++;
			}
			return count;
		}),
	);
	return results.some(
		(result) => result.status === "fulfilled" && result.value > 0,
	);
}
export async function finishIntegrationPump(
	token: string,
	role: IntegrationRole,
) {
	await database().execute(
		sql`update integration_jobs set status='done',lease_until=null where key=${`dispatcher:${role}`} and lease_token=${token}`,
	);
}
