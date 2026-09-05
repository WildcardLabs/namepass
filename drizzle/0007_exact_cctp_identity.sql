/*
 * Stage 2 requires a maintenance window.
 *
 * Pause Goldsky delivery, recovery, and new workflow starts. Deploy migration
 * 0006 and the stage-1 application first. Let stage-1 workflows reconcile and
 * release their Workflow owners before this migration. The table lock makes an
 * unexpected writer fail or wait instead of changing repair input.
 */
LOCK TABLE
	"flows",
	"transaction_intents",
	"flow_transitions",
	"chain_events",
	"deposits"
IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

/* Repeat the safe backfill in case a stage-1 event arrived after 0006 ran. */
CREATE TEMP TABLE "_origin_event_backfill" ON COMMIT DROP AS
WITH "candidates" AS (
	SELECT
		"flow"."id" AS "flow_id",
		"event"."event_id",
		count(*) OVER (PARTITION BY "flow"."id") AS "flow_match_count",
		count(*) OVER (PARTITION BY "event"."event_id") AS "event_match_count"
	FROM "flows" AS "flow"
	INNER JOIN "names" AS "name" ON "name"."id" = "flow"."name_id"
	INNER JOIN "chain_events" AS "event"
		ON "event"."event_family" = 'namepass'
		AND "event"."event_type" = 'DepositProcessed'
		AND "event"."canonical" = true
		AND "event"."chain_id" = "flow"."origin_chain_id"
		AND lower("event"."tx_hash") = lower("flow"."origin_evidence_tx_hash")
		AND lower("event"."facts"->>'label_key') = lower("name"."label_hash")
		AND lower("event"."facts"->>'wallet_address') = lower("name"."deposit_address")
		AND ("flow"."amount_processed" IS NULL OR "event"."facts"->>'amount' = "flow"."amount_processed"::text)
		AND ("flow"."remaining_amount" IS NULL OR "event"."facts"->>'remaining_amount' = "flow"."remaining_amount"::text)
	WHERE "flow"."origin_event_id" IS NULL
		AND "flow"."origin_evidence_tx_hash" IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM "flows" AS "owner"
			WHERE "owner"."origin_event_id" = "event"."event_id"
		)
)
SELECT "flow_id", "event_id"
FROM "candidates"
WHERE "flow_match_count" = 1 AND "event_match_count" = 1;
--> statement-breakpoint

UPDATE "flows" AS "flow"
SET "origin_event_id" = "candidate"."event_id", "updated_at" = now()
FROM "_origin_event_backfill" AS "candidate"
WHERE "flow"."id" = "candidate"."flow_id"
	AND "flow"."origin_event_id" IS NULL;
--> statement-breakpoint

/* Do not guess which event owns an ambiguous historical origin flow. */
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "flows"
		WHERE "trigger" = 'external'
			AND "origin_evidence_tx_hash" IS NOT NULL
			AND "origin_event_id" IS NULL
			AND "origin_tx_intent_id" IS NULL
	) THEN
		RAISE EXCEPTION
			'An external origin flow needs manual exact-event repair.';
	END IF;
END
$$;
--> statement-breakpoint

/* Load every duplicate Circle identity across all flow statuses. */
CREATE TEMP TABLE "_cctp_duplicate_members" ON COMMIT DROP AS
WITH "duplicate_keys" AS (
	SELECT "origin_chain_id", "cctp_nonce"
	FROM "flows"
	WHERE "cctp_nonce" IS NOT NULL
	GROUP BY "origin_chain_id", "cctp_nonce"
	HAVING count(*) > 1
)
SELECT
	"flow"."id",
	"flow"."name_id",
	"flow"."origin_chain_id",
	"flow"."cctp_nonce",
	"flow"."status",
	"flow"."trigger",
	"flow"."workflow_run_id",
	"flow"."deposit_event_id",
	"flow"."renewal_event_id",
	"flow"."origin_tx_intent_id",
	"flow"."origin_event_id",
	"flow"."origin_evidence_tx_hash",
	"flow"."claim_tx_intent_id",
	"flow"."amount_processed",
	"flow"."gas_allowance",
	"flow"."amount_applied",
	"flow"."duration_seconds",
	"flow"."expiry_after",
	"flow"."cctp_message_index",
	"flow"."cctp_message",
	"flow"."cctp_attestation",
	"flow"."settled_at",
	(
		"flow"."renewal_event_id" IS NULL
		AND "flow"."cctp_message" IS NOT NULL
		AND "flow"."cctp_attestation" IS NOT NULL
		AND (
			"flow"."deposit_event_id" IS NOT NULL
			OR "flow"."origin_event_id" IS NOT NULL
			OR "flow"."origin_tx_intent_id" IS NOT NULL
			OR "flow"."origin_evidence_tx_hash" IS NOT NULL
		)
	) AS "is_source",
	(
		"flow"."trigger" = 'external'
		AND "flow"."status" = 'settled'
		AND "flow"."renewal_event_id" IS NOT NULL
		AND "flow"."deposit_event_id" IS NULL
		AND "flow"."origin_event_id" IS NULL
		AND "flow"."origin_evidence_tx_hash" IS NULL
		AND "flow"."origin_tx_intent_id" IS NULL
		AND "flow"."claim_tx_intent_id" IS NULL
		AND "flow"."cctp_message_index" IS NULL
		AND "flow"."cctp_message" IS NULL
		AND "flow"."cctp_attestation" IS NULL
	) AS "is_bare"
FROM "flows" AS "flow"
INNER JOIN "duplicate_keys" AS "duplicate"
	ON "duplicate"."origin_chain_id" = "flow"."origin_chain_id"
	AND "duplicate"."cctp_nonce" = "flow"."cctp_nonce";
--> statement-breakpoint

/* Convert a complete bytes32 nonce without the 64-bit limit of to_hex(). */
CREATE OR REPLACE FUNCTION pg_temp."_hex_uint256_to_numeric"("hex_value" text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
	"digits" text := regexp_replace(lower("hex_value"), '^0x', '');
	"result" numeric := 0;
	"position" integer;
	"digit" integer;
BEGIN
	IF "digits" !~ '^[0-9a-f]{64}$' THEN
		RAISE EXCEPTION 'Invalid uint256 hexadecimal value.';
	END IF;
	FOR "position" IN 1..length("digits") LOOP
		"digit" := strpos('0123456789abcdef', substr("digits", "position", 1)) - 1;
		"result" := "result" * 16 + "digit";
	END LOOP;
	RETURN "result";
END
$$;
--> statement-breakpoint

/* A migration must not change a flow that still has an active owner or write. */
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "_cctp_duplicate_members"
		WHERE "workflow_run_id" IS NOT NULL
	) THEN
		RAISE EXCEPTION
			'Cannot repair a Circle duplicate group with a Workflow owner.';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "_cctp_duplicate_members" AS "member"
		INNER JOIN "transaction_intents" AS "intent"
			ON "intent"."flow_id" = "member"."id"
		WHERE "intent"."status" NOT IN ('confirmed', 'reverted')
	) THEN
		RAISE EXCEPTION
			'Cannot repair a Circle duplicate group with an unresolved transaction intent.';
	END IF;
END
$$;
--> statement-breakpoint

/* Accept only one evidence-rich source and one bare external projection. */
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "_cctp_duplicate_members"
		GROUP BY "origin_chain_id", "cctp_nonce"
		HAVING count(*) <> 2
			OR count(*) FILTER (WHERE "is_source") <> 1
			OR count(*) FILTER (WHERE "is_bare") <> 1
			OR count(DISTINCT "name_id") <> 1
			OR count("amount_processed") <> 2
			OR count(DISTINCT "amount_processed") <> 1
			OR count("renewal_event_id") <> 1
	) THEN
		RAISE EXCEPTION
			'A Circle duplicate group does not match the guarded repair shape.';
	END IF;
END
$$;
--> statement-breakpoint

/* Verify the exact canonical settlement before ownership moves. */
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "_cctp_duplicate_members" AS "member"
		INNER JOIN "names" AS "name" ON "name"."id" = "member"."name_id"
		LEFT JOIN (
			VALUES
				('84532', '6'),
				('421614', '3'),
				('5042002', '26'),
				('8453', '6'),
				('42161', '3')
		) AS "domain" ("chain_id", "source_domain")
			ON "domain"."chain_id" = "member"."origin_chain_id"::text
		LEFT JOIN "chain_events" AS "renewal"
			ON "renewal"."event_id" = "member"."renewal_event_id"
		LEFT JOIN LATERAL (
			SELECT "candidate".*
			FROM "chain_events" AS "candidate"
			WHERE "candidate"."chain_id" = "renewal"."chain_id"
				AND lower("candidate"."tx_hash") = lower("renewal"."tx_hash")
				AND "candidate"."log_index" < "renewal"."log_index"
				AND "candidate"."event_family" = 'namepass'
				AND "candidate"."event_type" IN ('CCTPClaimed', 'Renewed')
			ORDER BY "candidate"."log_index" DESC
			LIMIT 1
		) AS "claim" ON true
		WHERE "member"."is_bare"
			AND (
				"renewal"."event_id" IS NULL
				OR "renewal"."canonical" IS DISTINCT FROM true
				OR "renewal"."event_family" <> 'namepass'
				OR "renewal"."event_type" <> 'Renewed'
				OR lower(coalesce("renewal"."facts"->>'label_hash', '')) <> lower("name"."label_hash")
				OR lower(coalesce("renewal"."facts"->>'wallet_address', '')) <> lower("name"."deposit_address")
				OR coalesce("renewal"."facts"->>'from_cctp', '') <> 'true'
				OR "claim"."event_id" IS NULL
				OR "claim"."canonical" IS DISTINCT FROM true
				OR "claim"."event_family" <> 'namepass'
				OR "claim"."event_type" <> 'CCTPClaimed'
				OR "domain"."source_domain" IS NULL
				OR coalesce("claim"."facts"->>'source_domain', '') <> "domain"."source_domain"
				OR CASE
					WHEN coalesce("claim"."facts"->>'nonce', '') !~ '^0x[0-9a-fA-F]{64}$'
						THEN true
					ELSE pg_temp."_hex_uint256_to_numeric"("claim"."facts"->>'nonce')
						<> "member"."cctp_nonce"
				END
				OR lower(coalesce("claim"."facts"->>'wallet_address', ''))
					<> lower("name"."deposit_address")
				OR coalesce("claim"."facts"->>'burn_amount', '')
					<> "member"."amount_processed"::text
				OR CASE
					WHEN coalesce("claim"."facts"->>'burn_amount', '') !~ '^(0|[1-9][0-9]*)$'
						OR coalesce("claim"."facts"->>'fee_executed', '') !~ '^(0|[1-9][0-9]*)$'
						OR coalesce("claim"."facts"->>'minted_amount', '') !~ '^(0|[1-9][0-9]*)$'
						OR coalesce("renewal"."facts"->>'amount_received', '') !~ '^(0|[1-9][0-9]*)$'
						THEN true
					ELSE ("claim"."facts"->>'fee_executed')::numeric
							> ("claim"."facts"->>'burn_amount')::numeric
						OR ("claim"."facts"->>'burn_amount')::numeric
							- ("claim"."facts"->>'fee_executed')::numeric
							<> ("claim"."facts"->>'minted_amount')::numeric
						OR ("claim"."facts"->>'minted_amount')::numeric
							<> ("renewal"."facts"->>'amount_received')::numeric
				END
			)
	) THEN
		RAISE EXCEPTION
			'A bare external flow does not own the exact canonical CCTP settlement bundle.';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "_cctp_duplicate_members" AS "member"
		LEFT JOIN "chain_events" AS "origin_event"
			ON "origin_event"."event_id" = "member"."origin_event_id"
		WHERE "member"."is_source"
			AND "member"."origin_event_id" IS NOT NULL
			AND "origin_event"."canonical" IS DISTINCT FROM true
	) THEN
		RAISE EXCEPTION
			'A source flow points to a noncanonical origin event.';
	END IF;
END
$$;
--> statement-breakpoint

CREATE TEMP TABLE "_cctp_repair_map" ON COMMIT DROP AS
SELECT
	"source"."id" AS "canonical_id",
	"source"."status" AS "canonical_status",
	"source"."deposit_event_id" AS "canonical_deposit_event_id",
	"external"."id" AS "loser_id",
	"external"."status" AS "loser_status",
	"source"."origin_chain_id",
	"source"."cctp_nonce",
	"external"."renewal_event_id",
	"external"."amount_processed",
	"external"."gas_allowance",
	"external"."amount_applied",
	"external"."duration_seconds",
	"external"."expiry_after",
	"external"."settled_at"
FROM "_cctp_duplicate_members" AS "source"
INNER JOIN "_cctp_duplicate_members" AS "external"
	ON "external"."origin_chain_id" = "source"."origin_chain_id"
	AND "external"."cctp_nonce" = "source"."cctp_nonce"
WHERE "source"."is_source" AND "external"."is_bare";
--> statement-breakpoint

INSERT INTO "flow_transitions" (
	"flow_id", "from_status", "to_status", "actor", "reason_code", "detail"
)
SELECT
	"loser_id", "loser_status", 'cancelled', 'migration', 'duplicate_flow_repaired',
	jsonb_build_object(
		'canonicalFlowId', "canonical_id",
		'originChainId', "origin_chain_id"::text,
		'cctpNonce', "cctp_nonce"::text
	)
FROM "_cctp_repair_map";
--> statement-breakpoint

INSERT INTO "flow_transitions" (
	"flow_id", "from_status", "to_status", "actor", "reason_code", "detail"
)
SELECT
	"canonical_id", "canonical_status", 'settled', 'migration', 'external_settlement_merged',
	jsonb_build_object('mergedFlowId', "loser_id")
FROM "_cctp_repair_map"
WHERE "canonical_status" <> 'settled';
--> statement-breakpoint

/* Release the renewal-event identity before the canonical row receives it. */
UPDATE "flows" AS "loser"
SET
	"renewal_event_id" = NULL,
	"origin_event_id" = NULL,
	"origin_evidence_tx_hash" = NULL,
	"cctp_message_index" = NULL,
	"cctp_message" = NULL,
	"cctp_nonce" = NULL,
	"cctp_attestation" = NULL,
	"status" = 'cancelled',
	"hold_reason" = NULL,
	"workflow_run_id" = NULL,
	"amount_processed" = NULL,
	"gas_allowance" = NULL,
	"amount_applied" = NULL,
	"duration_seconds" = NULL,
	"expiry_after" = NULL,
	"last_error_code" = 'duplicate_flow_repaired',
	"last_error_detail" = "repair"."canonical_id"::text,
	"next_action_at" = NULL,
	"settled_at" = NULL,
	"failed_at" = NULL,
	"cancelled_at" = now(),
	"updated_at" = now()
FROM "_cctp_repair_map" AS "repair"
WHERE "loser"."id" = "repair"."loser_id";
--> statement-breakpoint

UPDATE "flows" AS "canonical"
SET
	"renewal_event_id" = "repair"."renewal_event_id",
	"status" = 'settled',
	"amount_processed" = "repair"."amount_processed",
	"gas_allowance" = "repair"."gas_allowance",
	"amount_applied" = "repair"."amount_applied",
	"duration_seconds" = "repair"."duration_seconds",
	"expiry_after" = "repair"."expiry_after",
	"hold_reason" = NULL,
	"workflow_run_id" = NULL,
	"last_error_code" = NULL,
	"last_error_detail" = NULL,
	"next_action_at" = NULL,
	"settled_at" = "repair"."settled_at",
	"cancelled_at" = NULL,
	"failed_at" = NULL,
	"updated_at" = now()
FROM "_cctp_repair_map" AS "repair"
WHERE "canonical"."id" = "repair"."canonical_id";
--> statement-breakpoint

UPDATE "deposits" AS "deposit"
SET "status" = 'finalized'
FROM "flows" AS "canonical"
INNER JOIN "_cctp_repair_map" AS "repair"
	ON "repair"."canonical_id" = "canonical"."id"
WHERE "deposit"."event_id" = "canonical"."deposit_event_id";
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "flows"
		WHERE "cctp_nonce" IS NOT NULL
		GROUP BY "origin_chain_id", "cctp_nonce"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION
			'Unhandled Circle duplicate identities remain after repair.';
	END IF;
END
$$;
--> statement-breakpoint

CREATE UNIQUE INDEX "flows_cctp_nonce_unique"
	ON "flows" USING btree ("origin_chain_id", "cctp_nonce")
	WHERE "flows"."cctp_nonce" IS NOT NULL;
