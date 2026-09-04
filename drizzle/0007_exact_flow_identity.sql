WITH ranked AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY origin_chain_id, lower(origin_evidence_tx_hash)
			ORDER BY (status = 'settled') DESC, (trigger <> 'external') DESC,
				(deposit_event_id IS NOT NULL) DESC, created_at, id
		) AS position
	FROM flows
	WHERE origin_evidence_tx_hash IS NOT NULL AND status <> 'cancelled'
), duplicates AS (
	SELECT id FROM ranked WHERE position > 1
)
UPDATE transaction_intents
SET status = 'cancellation_requested',
	error = jsonb_build_object('code', 'duplicate_message_settled'),
	updated_at = now()
WHERE flow_id IN (SELECT id FROM duplicates)
	AND status IN ('prepared', 'broadcast');
--> statement-breakpoint
WITH ranked AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY origin_chain_id, lower(origin_evidence_tx_hash)
			ORDER BY (status = 'settled') DESC, (trigger <> 'external') DESC,
				(deposit_event_id IS NOT NULL) DESC, created_at, id
		) AS position
	FROM flows
	WHERE origin_evidence_tx_hash IS NOT NULL AND status <> 'cancelled'
)
UPDATE flows
SET status = 'cancelled', workflow_run_id = NULL,
	last_error_code = 'duplicate_message_settled', next_action_at = NULL,
	cancelled_at = now(), updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE position > 1);
--> statement-breakpoint
WITH ranked AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY origin_chain_id, cctp_nonce
			ORDER BY (status = 'settled') DESC, (trigger <> 'external') DESC,
				(deposit_event_id IS NOT NULL) DESC, created_at, id
		) AS position
	FROM flows
	WHERE cctp_nonce IS NOT NULL AND status <> 'cancelled'
), duplicates AS (
	SELECT id FROM ranked WHERE position > 1
)
UPDATE transaction_intents
SET status = 'cancellation_requested',
	error = jsonb_build_object('code', 'duplicate_message_settled'),
	updated_at = now()
WHERE flow_id IN (SELECT id FROM duplicates)
	AND status IN ('prepared', 'broadcast');
--> statement-breakpoint
WITH ranked AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY origin_chain_id, cctp_nonce
			ORDER BY (status = 'settled') DESC, (trigger <> 'external') DESC,
				(deposit_event_id IS NOT NULL) DESC, created_at, id
		) AS position
	FROM flows
	WHERE cctp_nonce IS NOT NULL AND status <> 'cancelled'
)
UPDATE flows
SET status = 'cancelled', workflow_run_id = NULL,
	last_error_code = 'duplicate_message_settled', next_action_at = NULL,
	cancelled_at = now(), updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE position > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "flows_origin_evidence_tx_unique"
	ON "flows" USING btree ("origin_chain_id", lower("origin_evidence_tx_hash"))
	WHERE "origin_evidence_tx_hash" IS NOT NULL AND "status" <> 'cancelled';
--> statement-breakpoint
CREATE UNIQUE INDEX "flows_cctp_nonce_unique"
	ON "flows" USING btree ("origin_chain_id", "cctp_nonce")
	WHERE "cctp_nonce" IS NOT NULL AND "status" <> 'cancelled';
