ALTER TABLE "transaction_intents" ADD COLUMN "last_broadcast_attempt_at" timestamp (3) with time zone;
--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD COLUMN "pending_warned_at" timestamp (3) with time zone;
--> statement-breakpoint
CREATE INDEX "transaction_intents_lane_status_nonce_idx" ON "transaction_intents" USING btree ("chain_id","from_address","status","nonce");
