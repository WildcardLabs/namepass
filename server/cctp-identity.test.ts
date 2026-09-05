import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

import {
	cctpFlowRowsLockSql,
	cctpIdentityAction,
	hasCctpSourceEvidence,
	isBareExternalSettlement,
	type CctpIdentityFlow,
} from "./cctp-identity";

function identityFlow(patch: Partial<CctpIdentityFlow> = {}): CctpIdentityFlow {
	return {
		id: "source",
		nameId: "name",
		originChainId: "84532",
		status: "waiting_attestation",
		trigger: "automatic",
		depositEventId: "deposit",
		originEventId: "origin",
		originEvidenceTxHash: `0x${"1".repeat(64)}`,
		originTxIntentId: "origin-intent",
		claimTxIntentId: null,
		renewalEventId: null,
		amountProcessed: "1000000",
		cctpMessageIndex: 0,
		cctpMessage: "0x12",
		cctpAttestation: null,
		...patch,
	};
}

test("CCTP identity keeps the evidence-rich source flow", () => {
	const source = identityFlow();
	const external = identityFlow({
		id: "external",
		trigger: "external",
		status: "settled",
		depositEventId: null,
		originEventId: null,
		originEvidenceTxHash: null,
		originTxIntentId: null,
		claimTxIntentId: null,
		renewalEventId: "renewal",
		cctpMessageIndex: null,
		cctpMessage: null,
		cctpAttestation: null,
	});
	assert.equal(hasCctpSourceEvidence(source), true);
	assert.equal(isBareExternalSettlement(external), true);
	assert.equal(cctpIdentityAction(source, external), "merge_external");
	assert.equal(cctpIdentityAction(source, source), "same");
	assert.equal(cctpIdentityAction(source, undefined), "assign");
});

test("CCTP identity does not treat legacy source evidence as a bare settlement", () => {
	const bare = identityFlow({
		id: "external",
		trigger: "external",
		status: "settled",
		depositEventId: null,
		originEventId: null,
		originEvidenceTxHash: null,
		originTxIntentId: null,
		claimTxIntentId: null,
		renewalEventId: "renewal",
		cctpMessageIndex: null,
		cctpMessage: null,
		cctpAttestation: null,
	});
	for (const evidence of [
		{ originEvidenceTxHash: `0x${"2".repeat(64)}` },
		{ cctpMessageIndex: 0 },
	]) {
		const flow = { ...bare, ...evidence };
		assert.equal(hasCctpSourceEvidence(flow), true);
		assert.equal(isBareExternalSettlement(flow), false);
	}
});

test("CCTP identity rejects two evidence-rich owners", () => {
	assert.equal(cctpIdentityAction(identityFlow(), identityFlow({ id: "other" })), "conflict");
});

test("CCTP merge candidates lock in stable row order", () => {
	const query = new PgDialect().sqlToQuery(cctpFlowRowsLockSql([
		"22222222-2222-4222-8222-222222222222",
		"11111111-1111-4111-8111-111111111111",
	]));
	assert.match(query.sql, /order by id/);
	assert.match(query.sql, /for update/);
});
