import { and, eq, isNull, or } from "drizzle-orm";
import { start } from "workflow/api";

import { database } from "./db/client";
import { flows } from "./db/schema";
import { chainById, HUB_CHAIN } from "../src/lib/chains";
import { cctpRenewal } from "../workflows/cctp-renewal";
import { ethereumRenewal } from "../workflows/ethereum";

const STARTING = "starting:";

export function workflowClaimQuery(
	db: ReturnType<typeof database>,
	flowId: string,
	marker: string,
) {
	return db.update(flows).set({ workflowRunId: marker, updatedAt: new Date() })
		.where(and(
			eq(flows.id, flowId),
			or(isNull(flows.workflowRunId), eq(flows.workflowRunId, marker)),
		)).returning({ id: flows.id });
}

/** Claim the flow before start() so duplicate webhooks cannot create two workflow owners. */
export async function startRenewalWorkflow(flowId: string): Promise<void> {
	const [flow] = await database().select({ originChainId: flows.originChainId })
		.from(flows).where(eq(flows.id, flowId));
	if (!flow) throw new Error("The flow does not exist.");
	const chain = chainById(Number(flow.originChainId));
	if (!chain) throw new Error(`Chain ${flow.originChainId} is not active.`);
	const marker = `${STARTING}${crypto.randomUUID()}`;
	const claimed = (await workflowClaimQuery(database(), flowId, marker)).length === 1;
	if (!claimed) return;
	try {
		const run = chain.chainId === HUB_CHAIN.chainId
			? await start(ethereumRenewal, [flowId])
			: await start(cctpRenewal, [flowId]);
		await database().update(flows).set({ workflowRunId: run.runId, updatedAt: new Date() })
			.where(eq(flows.workflowRunId, marker));
	} catch (error) {
		await database().update(flows).set({ workflowRunId: null, updatedAt: new Date() })
			.where(eq(flows.workflowRunId, marker));
		throw error;
	}
}
