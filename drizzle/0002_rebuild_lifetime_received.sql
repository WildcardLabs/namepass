UPDATE "names" AS "name"
SET "lifetime_received" = COALESCE((
	SELECT SUM(("event"."facts"->>'amount_received')::numeric)
	FROM "chain_events" AS "event"
	WHERE "event"."canonical" = true
		AND "event"."event_family" = 'namepass'
		AND "event"."event_type" = 'Renewed'
		AND lower("event"."facts"->>'label_hash') = lower("name"."label_hash")
), 0);
