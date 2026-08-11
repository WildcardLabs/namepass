import { waitForSleep } from "@workflow/vitest";
import { expect, test } from "vitest";
import { getRun, start } from "workflow/api";

import { runtimeProbe } from "./runtime";

test("the Workflow runtime persists a step and resumes a sleep", async () => {
	const run = await start(runtimeProbe, ["saved"]);
	const sleepId = await waitForSleep(run);
	await getRun(run.runId).wakeUp({ correlationIds: [sleepId] });

	await expect(run.returnValue).resolves.toBe("saved:resumed");
	await expect(run.status).resolves.toBe("completed");
});
