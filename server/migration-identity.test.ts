import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stageOne = readFileSync(
	new URL("../drizzle/0006_transaction_identity_support.sql", import.meta.url),
	"utf8",
);
const stageTwo = readFileSync(
	new URL("../drizzle/0007_exact_cctp_identity.sql", import.meta.url),
	"utf8",
);

test("origin identity backfill accepts only one-to-one event matches", () => {
	assert.match(stageOne, /flow_match_count" = 1/);
	assert.match(stageOne, /event_match_count" = 1/);
	assert.doesNotMatch(stageOne, /origin_evidence_tx_unique/);
});

test("Circle duplicate repair fails closed before the full unique index", () => {
	const splitMap = stageTwo.indexOf('CREATE TEMP TABLE "_cctp_split_repair_map"');
	const splitMutation = stageTwo.indexOf('UPDATE "flows" AS "loser"');
	const guard = stageTwo.indexOf("does not match the guarded repair shape");
	const guardedMutation = stageTwo.indexOf(
		'UPDATE "flows" AS "loser"',
		splitMutation + 1,
	);
	const uniqueIndex = stageTwo.indexOf('CREATE UNIQUE INDEX "flows_cctp_nonce_unique"');
	assert.ok(splitMap >= 0 && splitMap < splitMutation);
	assert.ok(guard >= 0 && guard < guardedMutation && guardedMutation < uniqueIndex);
	assert.match(stageTwo, /status" NOT IN \('confirmed', 'reverted'\)/);
	assert.doesNotMatch(stageTwo, /row_number\s*\(/i);
	assert.doesNotMatch(stageTwo.slice(uniqueIndex), /status/);
});

test("split-evidence repair requires exact origin and settlement ownership", () => {
	const repair = stageTwo.slice(
		stageTwo.indexOf('CREATE TEMP TABLE "_cctp_split_repair_map"'),
		stageTwo.indexOf("A migration must not change a flow"),
	);
	for (const evidence of [
		'event_family" = \'deposit\'',
		'event_type" = \'Transfer\'',
		'event_type" = \'DepositProcessed\'',
		'kind" = \'origin_renew\'',
		'kind" = \'claim\'',
		'status" = \'confirmed\'',
		'status" = \'reverted\'',
		'event_type" = \'Renewed\'',
		'event_type" = \'CCTPClaimed\'',
		"source_domain",
		"nonce",
		"wallet_address",
		"burn_amount",
		"fee_executed",
		"minted_amount",
		"amount_received",
		"gas_allowance",
		"amount_applied",
		"duration",
		"remainder",
	]) {
		assert.match(repair, new RegExp(evidence));
	}
	assert.match(repair, /count\(\*\)[\s\S]*= 2/);
	assert.match(repair, /evidenceShape', 'split_origin_and_settlement'/);
	assert.match(repair, /status" NOT IN \('confirmed', 'reverted'\)/);
});

test("Circle duplicate repair verifies the exact preceding claim bundle", () => {
	const verification = stageTwo.slice(
		stageTwo.indexOf("Verify the exact canonical settlement"),
		stageTwo.indexOf('CREATE TEMP TABLE "_cctp_repair_map"'),
	);
	assert.match(verification, /LEFT JOIN LATERAL/);
	assert.match(verification, /event_type" IN \('CCTPClaimed', 'Renewed'\)/);
	assert.match(verification, /ORDER BY "candidate"\."log_index" DESC/);
	assert.match(verification, /_hex_uint256_to_numeric/);
	for (const field of [
		"source_domain",
		"nonce",
		"wallet_address",
		"burn_amount",
		"fee_executed",
		"minted_amount",
		"amount_received",
	]) {
		assert.match(verification, new RegExp(field));
	}
});
