DROP INDEX "flows_one_active_per_name_chain";--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "origin_event_id" text;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "cctp_message_index" integer;--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD COLUMN "last_broadcast_attempt_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD COLUMN "pending_warned_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_origin_event_id_chain_events_event_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "public"."chain_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
WITH "origin_candidates" AS (
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
),
"exact_origin_candidates" AS (
	SELECT "flow_id", "event_id"
	FROM "origin_candidates"
	WHERE "flow_match_count" = 1 AND "event_match_count" = 1
)
UPDATE "flows" AS "flow"
SET "origin_event_id" = "candidate"."event_id", "updated_at" = now()
FROM "exact_origin_candidates" AS "candidate"
WHERE "flow"."id" = "candidate"."flow_id"
	AND "flow"."origin_event_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "flows_origin_event_unique" ON "flows" USING btree ("origin_event_id") WHERE "flows"."origin_event_id" is not null;--> statement-breakpoint
CREATE INDEX "transaction_intents_lane_status_nonce_idx" ON "transaction_intents" USING btree ("chain_id","from_address","status","nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_one_active_per_name_chain" ON "flows" USING btree ("name_id","origin_chain_id") WHERE "flows"."origin_event_id" is null and "flows"."status" in ('queued', 'confirming_deposit', 'checking_name', 'submitting_origin', 'waiting_origin', 'held');--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_cctp_message_index_nonnegative" CHECK ("flows"."cctp_message_index" is null or "flows"."cctp_message_index" >= 0);
