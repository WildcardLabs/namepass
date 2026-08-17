import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./db/schema";
import { workflowClaimQuery, workflowRunIsActive } from "./workflows";

test("workflow ownership updates only the requested flow", () => {
	const query = workflowClaimQuery(
		drizzle.mock({ schema }),
		"00000000-0000-4000-8000-000000000001",
		"starting:test",
	).toSQL();
	assert.match(query.sql, /where \("flows"\."id" = \$\d+ and \("flows"\."workflow_run_id" is null or "flows"\."workflow_run_id" = \$\d+\)\)/);
	assert.ok(query.params.includes("00000000-0000-4000-8000-000000000001"));
});

test("only live Workflow states keep ownership", () => {
	for (const status of ["pending", "running"]) {
		assert.equal(workflowRunIsActive(status), true);
	}
	for (const status of ["completed", "failed", "cancelled"]) {
		assert.equal(workflowRunIsActive(status), false);
	}
});
