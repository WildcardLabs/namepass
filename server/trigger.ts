import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { parseAbi, type Address } from "viem";

import { chainById } from "../src/lib/chains";
import { InvalidLabelError, normalizeLabel } from "../src/lib/namepass";
import { readEnsState } from "./chain";
import { minimumTriggerAmount } from "./config";
import { database } from "./db/client";
import { chainEvents, deposits, flows, flowTransitions, names } from "./db/schema";
import { ApiError } from "./http";
import { verifiedChainClient } from "./transactions";
import { startRenewalWorkflow } from "./workflows";
import {
	queueStoppedFlow,
	stoppedDepositFlowCandidate,
	stoppedFlowRecoveryAction,
} from "./stopped-flows";

const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const TERMINAL = ["settled", "cancelled", "failed"] as Array<typeof flows.$inferSelect.status>;
const RESUMABLE = [
	"queued",
	"confirming_deposit",
	"checking_name",
	"submitting_origin",
	"waiting_origin",
	"waiting_attestation",
	"submitting_claim",
	"waiting_claim",
] as Array<typeof flows.$inferSelect.status>;

export interface TriggerResult {
	flowId: string;
	status: typeof flows.$inferSelect.status;
	httpStatus: 200 | 202;
}

export function manualTriggerAction(
	status: typeof flows.$inferSelect.status | undefined,
	renewable: boolean,
	balanceEligible: boolean | undefined,
): "read_balance" | "create" | "same" | "resume" | "resume_unclaimed" | "conflict" | "name_ineligible" | "balance_ineligible" {
	if (status && RESUMABLE.includes(status)) return "same";
	if (!renewable) return "name_ineligible";
	if (status === "unclaimed") return "resume_unclaimed";
	if (balanceEligible === undefined) return "read_balance";
	if (!balanceEligible) return "balance_ineligible";
	if (!status) return "create";
	if (status === "held") return "resume";
	return "conflict";
}

export function unclaimedTriggerStatus(workflowRunId: string | null): 200 | 202 {
	return workflowRunId ? 200 : 202;
}

async function start(flowId: string): Promise<void> {
	try {
		await startRenewalWorkflow(flowId);
	} catch {
		throw new ApiError(503, "workflow_unavailable", "The renewal workflow is not available.");
	}
}

async function queueExisting(flow: typeof flows.$inferSelect): Promise<TriggerResult> {
	if (flow.status === "unclaimed") {
		if (!flow.cctpMessage || !flow.cctpAttestation) {
			throw new ApiError(409, "invalid_unclaimed_flow", "The unclaimed Circle evidence is incomplete.");
		}
		const httpStatus = unclaimedTriggerStatus(flow.workflowRunId);
		if (httpStatus === 200) {
			return { flowId: flow.id, status: "unclaimed", httpStatus };
		}
		await database().update(flows).set({
			holdReason: null,
			lastErrorCode: null,
			nextActionAt: new Date(),
			updatedAt: new Date(),
		}).where(eq(flows.id, flow.id));
		await start(flow.id);
		return { flowId: flow.id, status: "unclaimed", httpStatus };
	}
	if (RESUMABLE.includes(flow.status)) {
		await start(flow.id);
		return { flowId: flow.id, status: flow.status, httpStatus: 200 };
	}
	if (flow.status !== "held") {
		throw new ApiError(409, "flow_active", "A non-resumable flow is active.", {
			flowId: flow.id,
			status: flow.status,
		});
	}
	const now = new Date();
	await database().transaction(async (tx) => {
		await tx.update(flows).set({
			status: "queued",
			holdReason: null,
			lastErrorCode: null,
			nextActionAt: null,
			workflowRunId: null,
			queuedAt: now,
			updatedAt: now,
		}).where(eq(flows.id, flow.id));
		await tx.insert(flowTransitions).values({
			flowId: flow.id,
			fromStatus: "held",
			toStatus: "queued",
			actor: "api",
			reasonCode: "manual_resume",
		});
	});
	await start(flow.id);
	return { flowId: flow.id, status: "queued", httpStatus: 202 };
}

/** Run all policy checks again. The browser does not decide eligibility. */
export async function triggerFlow(name: string, chainId: number): Promise<TriggerResult> {
	let label: string;
	try {
		label = normalizeLabel(name);
	} catch (error) {
		if (error instanceof InvalidLabelError) {
			throw new ApiError(422, "invalid_name", error.message);
		}
		throw error;
	}
	const chain = chainById(chainId);
	if (!chain) throw new ApiError(422, "unsupported_chain", "This chain is not supported.");
	const [nameRow] = await database().select().from(names).where(eq(names.normalizedLabel, label));
	if (!nameRow) throw new ApiError(422, "name_not_active", "Activate this name before you trigger a renewal.");

	const [[active], [stopped]] = await Promise.all([
		database().select().from(flows).where(and(
			eq(flows.nameId, nameRow.id),
			eq(flows.originChainId, String(chainId)),
			notInArray(flows.status, TERMINAL),
		)),
		database().select({
			flow: flows,
			depositAmount: deposits.amount,
		}).from(flows)
			.innerJoin(deposits, eq(flows.depositEventId, deposits.eventId))
			.innerJoin(chainEvents, eq(deposits.eventId, chainEvents.eventId))
			.where(and(
				eq(flows.nameId, nameRow.id),
				eq(flows.originChainId, String(chainId)),
				stoppedDepositFlowCandidate(),
				inArray(deposits.status, ["detected", "finalized"]),
				eq(chainEvents.canonical, true),
			))
			.orderBy(desc(flows.updatedAt))
			.limit(1),
	]);
	const ens = await readEnsState(label);
	let action = manualTriggerAction(active?.status, Boolean(ens.renewableBy), undefined);
	if (action === "name_ineligible") {
		throw new ApiError(active?.status === "unclaimed" ? 409 : 422, "name_not_renewable", "This name cannot be renewed now.", active ? { flowId: active.id, status: active.status } : undefined);
	}
	if (action === "resume_unclaimed") return queueExisting(active!);
	if (action === "same") return queueExisting(active!);

	const balance = await (await verifiedChainClient(chain)).readContract({
		address: chain.usdcAddress as Address,
		abi: ERC20_ABI,
		functionName: "balanceOf",
		args: [nameRow.depositAddress as Address],
		authorizationList: undefined,
	});
	action = manualTriggerAction(
		active?.status,
		true,
		balance >= minimumTriggerAmount(chainId),
	);
	if (action === "balance_ineligible") {
		throw new ApiError(422, "balance_ineligible", "The chain balance is below the trigger minimum.");
	}
	if (action !== "create") return queueExisting(active!);
	const recoveryAction = stopped ? stoppedFlowRecoveryAction({
		chainId,
		balance,
		amountDetected: stopped.flow.amountDetected,
		depositAmount: stopped.depositAmount,
	}) : "create_unlinked";
	if (stopped && recoveryAction === "resume_original") {
		if (await queueStoppedFlow(stopped.flow, "api")) {
			await start(stopped.flow.id);
			return { flowId: stopped.flow.id, status: "queued", httpStatus: 202 };
		}
	}

	const [created] = await database().insert(flows).values({
		nameId: nameRow.id,
		originChainId: String(chainId),
		trigger: "manual",
		holdReason: stopped ? "multiple_or_unlinked_deposits" : null,
		amountDetected: balance.toString(),
	}).onConflictDoNothing().returning({ id: flows.id, status: flows.status });
	if (created) {
		await start(created.id);
		return { flowId: created.id, status: created.status, httpStatus: 202 };
	}
	const [winner] = await database().select().from(flows).where(and(
		eq(flows.nameId, nameRow.id),
		eq(flows.originChainId, String(chainId)),
		notInArray(flows.status, TERMINAL),
	));
	if (!winner) throw new Error("The active-flow conflict has no winning row.");
	return queueExisting(winner);
}
