import assert from "node:assert/strict";
import test from "node:test";

import { flowTransitionAction, originWalletOwnsFlow, preOriginFlowAction, type FlowStatus } from "./flow-state";

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

test("an exact origin event releases the wallet before receipt parsing finishes", () => {
	assert.equal(originWalletOwnsFlow("waiting_origin", null), true);
	assert.equal(originWalletOwnsFlow("waiting_origin", "event-1"), false);
	assert.equal(originWalletOwnsFlow("waiting_attestation", null), false);
	assert.equal(originWalletOwnsFlow("submitting_claim", null), false);
	assert.equal(originWalletOwnsFlow("unclaimed", null), false);
});

test("a stale validator cannot stop a flow after transaction signing", () => {
	assert.equal(preOriginFlowAction("checking_name", false, ["checking_name"]), "apply");
	assert.equal(preOriginFlowAction("checking_name", true, ["checking_name"]), "ignore");
	assert.equal(preOriginFlowAction("waiting_origin", true, ["checking_name"]), "ignore");
});
