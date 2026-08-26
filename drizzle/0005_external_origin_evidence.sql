ALTER TABLE "flows" ADD COLUMN "origin_evidence_tx_hash" varchar(66);--> statement-breakpoint
UPDATE "transaction_intents" AS intent
SET
	"status" = 'confirmed',
	"confirmed_at" = COALESCE(intent."confirmed_at", event."block_time"),
	"updated_at" = now()
FROM "flows" AS flow
INNER JOIN "chain_events" AS event ON event."event_id" = flow."renewal_event_id"
WHERE intent."flow_id" = flow."id"
	AND flow."status" = 'settled'
	AND event."canonical" = true
	AND intent."current_tx_hash" = event."tx_hash"
	AND intent."status" = 'broadcast';
