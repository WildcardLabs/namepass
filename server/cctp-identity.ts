import { sql } from "drizzle-orm";

import { flows } from "./db/schema";

export type CctpIdentityFlow = Pick<
	typeof flows.$inferSelect,
	| "id"
	| "nameId"
	| "originChainId"
	| "status"
	| "trigger"
	| "depositEventId"
	| "originEventId"
	| "originEvidenceTxHash"
	| "originTxIntentId"
	| "claimTxIntentId"
	| "renewalEventId"
	| "amountProcessed"
	| "cctpMessageIndex"
	| "cctpMessage"
	| "cctpAttestation"
>;

/** Serialize ownership changes for one Circle source-domain nonce. */
export function cctpIdentityLockSql(originChainId: string, nonce: string) {
	return sql`select pg_advisory_xact_lock(hashtextextended(${`cctp:${originChainId}:${nonce}`}, 0))`;
}

/** Lock identity candidates in one stable order. */
export function cctpFlowRowsLockSql(flowIds: readonly string[]) {
	if (!flowIds.length) throw new Error("At least one CCTP flow is required.");
	return sql`
		select id
		from flows
		where id in (${sql.join(flowIds.map((flowId) => sql`${flowId}`), sql`, `)})
		order by id
		for update
	`;
}

export function hasCctpSourceEvidence(flow: CctpIdentityFlow): boolean {
	return flow.depositEventId !== null
		|| flow.originEventId !== null
		|| flow.originEvidenceTxHash !== null
		|| flow.originTxIntentId !== null
		|| flow.cctpMessageIndex !== null
		|| flow.cctpMessage !== null;
}

export function isBareExternalSettlement(flow: CctpIdentityFlow): boolean {
	return flow.trigger === "external"
		&& flow.status === "settled"
		&& flow.renewalEventId !== null
		&& flow.depositEventId === null
		&& flow.originEventId === null
		&& flow.originEvidenceTxHash === null
		&& flow.originTxIntentId === null
		&& flow.claimTxIntentId === null
		&& flow.cctpMessageIndex === null
		&& flow.cctpMessage === null
		&& flow.cctpAttestation === null;
}

export function cctpIdentityAction(
	current: CctpIdentityFlow,
	owner: CctpIdentityFlow | undefined,
): "assign" | "same" | "merge_external" | "conflict" {
	if (!owner) return "assign";
	if (owner.id === current.id) return "same";
	if (hasCctpSourceEvidence(current) && isBareExternalSettlement(owner)) return "merge_external";
	return "conflict";
}
