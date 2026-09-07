import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
	new URL("../drizzle/0008_absorbed_deposit_flows.sql", import.meta.url),
	"utf8",
);

test("the migration repairs only pre-origin flows consumed by a later empty-wallet origin", () => {
	assert.match(migration, /origin_evidence_block_number" > "deposits"\."block_number"/);
	assert.match(migration, /remaining_amount" = 0/);
	assert.match(migration, /origin_tx_intent_id" IS NULL/);
	assert.match(migration, /absorbed_by_prior_flow/);
	assert.doesNotMatch(migration, /amount_detected" =/);
});

test("the migration queues an exact recovery scan for eligible indexed balances", () => {
	assert.match(migration, /CREATE TABLE "balance_scan_requests"/);
	assert.match(migration, /"indexed_balances"\."amount" >= 500000/);
	assert.match(migration, /ON CONFLICT DO NOTHING/);
});
