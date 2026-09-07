ALTER TABLE "flows" ADD COLUMN "origin_evidence_block_number" numeric(78, 0);--> statement-breakpoint
CREATE TABLE "balance_scan_requests" (
	"name_id" uuid NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"requested_through_block" numeric(78, 0),
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_scan_requests_name_id_chain_id_pk" PRIMARY KEY("name_id","chain_id")
);--> statement-breakpoint
ALTER TABLE "balance_scan_requests" ADD CONSTRAINT "balance_scan_requests_name_id_names_id_fk" FOREIGN KEY ("name_id") REFERENCES "public"."names"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_scan_requests_updated_idx" ON "balance_scan_requests" USING btree ("updated_at");--> statement-breakpoint
UPDATE "flows"
SET "origin_evidence_block_number" = "chain_events"."block_number"
FROM "chain_events"
WHERE "flows"."origin_event_id" = "chain_events"."event_id"
	AND "chain_events"."canonical" = true;--> statement-breakpoint
UPDATE "flows"
SET "origin_evidence_block_number" = ("transaction_intents"."receipt"->>'blockNumber')::numeric
FROM "transaction_intents"
WHERE "transaction_intents"."id" = "flows"."origin_tx_intent_id"
	AND "flows"."origin_evidence_block_number" IS NULL
	AND "flows"."origin_evidence_tx_hash" IS NOT NULL
	AND "transaction_intents"."receipt"->>'blockNumber' ~ '^[0-9]+$';--> statement-breakpoint
WITH "absorbed" AS (
	SELECT DISTINCT ON ("ghost"."id")
		"ghost"."id" AS "ghost_id",
		"ghost"."status" AS "ghost_status",
		"owner"."id" AS "owner_id"
	FROM "flows" AS "ghost"
	JOIN "deposits" ON "deposits"."event_id" = "ghost"."deposit_event_id"
	JOIN "flows" AS "owner"
		ON "owner"."name_id" = "ghost"."name_id"
		AND "owner"."origin_chain_id" = "ghost"."origin_chain_id"
		AND "owner"."origin_evidence_block_number" > "deposits"."block_number"
		AND "owner"."origin_evidence_tx_hash" IS NOT NULL
		AND "owner"."remaining_amount" = 0
	WHERE "ghost"."origin_tx_intent_id" IS NULL
		AND "ghost"."origin_event_id" IS NULL
		AND "ghost"."status" IN ('queued', 'confirming_deposit', 'checking_name', 'held')
	ORDER BY "ghost"."id", "owner"."origin_evidence_block_number"
), "cancelled" AS (
	UPDATE "flows"
	SET
		"status" = 'cancelled',
		"hold_reason" = NULL,
		"workflow_run_id" = NULL,
		"last_error_code" = 'absorbed_by_prior_flow',
		"last_error_detail" = NULL,
		"next_action_at" = NULL,
		"cancelled_at" = now(),
		"updated_at" = now()
	FROM "absorbed"
	WHERE "flows"."id" = "absorbed"."ghost_id"
		AND "flows"."status" = "absorbed"."ghost_status"
	RETURNING "flows"."id"
)
INSERT INTO "flow_transitions" (
	"flow_id",
	"from_status",
	"to_status",
	"actor",
	"reason_code",
	"detail"
)
SELECT
	"absorbed"."ghost_id",
	"absorbed"."ghost_status",
	'cancelled',
	'migration',
	'absorbed_by_prior_flow',
	jsonb_build_object('consumingFlowId', "absorbed"."owner_id")
FROM "absorbed"
JOIN "cancelled" ON "cancelled"."id" = "absorbed"."ghost_id";--> statement-breakpoint
INSERT INTO "balance_scan_requests" ("name_id", "chain_id")
SELECT "names"."id", "chain_id"
FROM "names"
CROSS JOIN LATERAL unnest("names"."unscanned_chain_ids") AS "chain_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "balance_scan_requests" ("name_id", "chain_id")
SELECT "names"."id", "supported"."chain_id"
FROM "names"
CROSS JOIN (VALUES
	(11155111::numeric),
	(84532::numeric),
	(421614::numeric),
	(5042002::numeric)
) AS "supported"("chain_id")
WHERE NOT EXISTS (
	SELECT 1
	FROM "balance_snapshots"
	WHERE "balance_snapshots"."name_id" = "names"."id"
		AND "balance_snapshots"."chain_id" = "supported"."chain_id"
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH "indexed_balances" AS (
	SELECT
		"balance_snapshots"."name_id",
		"balance_snapshots"."chain_id",
		"balance_snapshots"."amount"
			+ coalesce((
				SELECT sum("deposits"."amount")
				FROM "deposits"
				JOIN "chain_events" ON "chain_events"."event_id" = "deposits"."event_id"
				WHERE "deposits"."name_id" = "balance_snapshots"."name_id"
					AND "deposits"."chain_id" = "balance_snapshots"."chain_id"
					AND "deposits"."status" IN ('detected', 'finalized')
					AND "chain_events"."canonical" = true
					AND "chain_events"."block_number" > "balance_snapshots"."block_number"
			), 0)
			- coalesce((
				SELECT sum(("chain_events"."facts"->>'amount')::numeric)
				FROM "chain_events"
				JOIN "names" ON "names"."id" = "balance_snapshots"."name_id"
				WHERE "chain_events"."chain_id" = "balance_snapshots"."chain_id"
					AND "chain_events"."event_family" = 'namepass'
					AND "chain_events"."event_type" = 'DepositProcessed'
					AND "chain_events"."canonical" = true
					AND "chain_events"."block_number" > "balance_snapshots"."block_number"
					AND lower("chain_events"."facts"->>'wallet_address') = lower("names"."deposit_address")
			), 0) AS "amount"
	FROM "balance_snapshots"
)
INSERT INTO "balance_scan_requests" ("name_id", "chain_id")
SELECT "indexed_balances"."name_id", "indexed_balances"."chain_id"
FROM "indexed_balances"
WHERE "indexed_balances"."amount" >= 500000
	AND NOT EXISTS (
		SELECT 1
		FROM "flows"
		WHERE "flows"."name_id" = "indexed_balances"."name_id"
			AND "flows"."origin_chain_id" = "indexed_balances"."chain_id"
			AND "flows"."origin_event_id" IS NULL
			AND "flows"."status" IN (
				'queued',
				'confirming_deposit',
				'checking_name',
				'submitting_origin',
				'waiting_origin',
				'held'
			)
	)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "names"
SET "unscanned_chain_ids" = (
	SELECT coalesce(array_agg("balance_scan_requests"."chain_id" ORDER BY "balance_scan_requests"."chain_id"), '{}'::numeric[])
	FROM "balance_scan_requests"
	WHERE "balance_scan_requests"."name_id" = "names"."id"
)
WHERE EXISTS (
	SELECT 1
	FROM "balance_scan_requests"
	WHERE "balance_scan_requests"."name_id" = "names"."id"
);
