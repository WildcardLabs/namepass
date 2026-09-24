import assert from "node:assert/strict";
import test from "node:test";

import triggerHandler from "../routes/api/flows/trigger";
import { manualTriggerAction } from "./trigger";

test("manual trigger policy resumes every active workflow stage", () => {
	assert.equal(manualTriggerAction(undefined, true, true), "create");
	assert.equal(manualTriggerAction("queued", true, true), "same");
	assert.equal(manualTriggerAction("held", true, true), "resume");
	assert.equal(manualTriggerAction("waiting_origin", true, true), "same");
	assert.equal(manualTriggerAction("waiting_claim", false, undefined), "same");
	assert.equal(manualTriggerAction(undefined, true, false), "balance_ineligible");
	assert.equal(manualTriggerAction(undefined, false, undefined), "name_ineligible");
	assert.equal(manualTriggerAction("unclaimed", true, undefined), "resume_unclaimed");
});

test("the trigger endpoint requires the documented name and chain ID", async () => {
	const response = await triggerHandler.fetch(new Request("https://namepass.test/api/flows/trigger", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ flowId: "00000000-0000-4000-8000-000000000001" }),
	}));
	assert.equal(response.status, 400);
	assert.equal((await response.json()).error.code, "invalid_request");
});
