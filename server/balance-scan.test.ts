import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

import { balanceScanCanComplete, originWalletLockSql, requestBalanceScanSql } from "./balance-scan";

test("a repeated scan request advances its version and keeps the highest block", () => {
	const query = new PgDialect().sqlToQuery(requestBalanceScanSql({
		nameId: "00000000-0000-4000-8000-000000000001",
		chainId: 84532,
		requestedThroughBlock: 46_507_024n,
	}));
	assert.match(query.sql, /greatest\(/);
	assert.match(query.sql, /balance_scan_requests\.version \+ 1/);
	assert.ok(query.params.includes("46507024"));
});

test("the origin-wallet lock is scoped to one name and chain", () => {
	const query = new PgDialect().sqlToQuery(originWalletLockSql("name-1", 84532));
	assert.match(query.sql, /pg_advisory_xact_lock/);
	assert.ok(query.params.includes("origin-wallet:name-1:84532"));
});

test("a scan clears only after it reaches the request watermark", () => {
	assert.equal(balanceScanCanComplete({
		requestedThroughBlock: "102",
		snapshotBlock: "101",
		blockedByFlow: false,
	}), false);
	assert.equal(balanceScanCanComplete({
		requestedThroughBlock: "102",
		snapshotBlock: "102",
		blockedByFlow: false,
	}), true);
	assert.equal(balanceScanCanComplete({
		requestedThroughBlock: "102",
		snapshotBlock: "103",
		blockedByFlow: true,
	}), false);
});
