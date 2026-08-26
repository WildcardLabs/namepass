import assert from "node:assert/strict";
import test from "node:test";

import { flowTransitionAction, originWalletOwnsStatus, type FlowStatus } from "./flow-state";

test("workflow stages move forward and may repeat their current stage", () => {
	assert.equal(flowTransitionAction("queued", "checking_name"), "apply");
	assert.equal(flowTransitionAction("waiting_origin", "waiting_origin"), "apply");
	assert.equal(flowTransitionAction("waiting_origin", "checking_name"), "ignore");
	assert.equal(flowTransitionAction("waiting_claim", "waiting_attestation"), "ignore");
});

test("terminal flow states reject late workflow updates", () => {
	for (const status of ["settled", "cancelled", "failed"] as FlowStatus[]) {
		assert.equal(flowTransitionAction(status, status), "apply");
		assert.equal(flowTransitionAction(status, "checking_name"), "ignore");
		assert.equal(flowTransitionAction(status, "waiting_origin"), "ignore");
	}
});

test("an unclaimed message can continue only through its claim stages", () => {
	assert.equal(flowTransitionAction("unclaimed", "checking_name"), "ignore");
	assert.equal(flowTransitionAction("unclaimed", "submitting_claim"), "apply");
	assert.equal(flowTransitionAction("unclaimed", "waiting_claim"), "apply");
	assert.equal(flowTransitionAction("unclaimed", "settled"), "apply");
});

test("a CCTP flow releases its origin wallet after the burn confirms", () => {
	assert.equal(originWalletOwnsStatus("waiting_origin"), true);
	assert.equal(originWalletOwnsStatus("waiting_attestation"), false);
	assert.equal(originWalletOwnsStatus("submitting_claim"), false);
	assert.equal(originWalletOwnsStatus("unclaimed"), false);
});
