// Integration tables are SQL-owned; migration 0009 also installs journal triggers.
import { names, flows, deposits } from "../db/schema";
import {
	pgTable,
	check,
	uuid,
	text,
	boolean,
	integer,
	timestamp,
	foreignKey,
	unique,
	index,
	jsonb,
	bigint,
	numeric,
	uniqueIndex,
	primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const integrationPartners = pgTable(
	"integration_partners",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		name: text().notNull(),
		enabled: boolean().default(true).notNull(),
		readRate: integer("read_rate").default(10).notNull(),
		writeRate: integer("write_rate").default(60).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	() => [
		check(
			"integration_partners_name_check",
			sql`(length(name) >= 1) AND (length(name) <= 120)`,
		),
		check(
			"integration_partners_read_rate_check",
			sql`(read_rate >= 1) AND (read_rate <= 1000)`,
		),
		check(
			"integration_partners_write_rate_check",
			sql`(write_rate >= 1) AND (write_rate <= 6000)`,
		),
	],
);

export const integrationKeys = pgTable(
	"integration_keys",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		partnerId: uuid("partner_id").notNull(),
		prefix: text().notNull(),
		digest: text().notNull(),
		scopes: text().array().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
	},
	(table) => [
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_keys_partner_id_fkey",
		}),
		unique("integration_keys_prefix_key").on(table.prefix),
		unique("integration_keys_digest_key").on(table.digest),
	],
);

export const integrationJobs = pgTable(
	"integration_jobs",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		key: text().notNull(),
		kind: text().notNull(),
		input: jsonb().notNull(),
		status: text().default("pending").notNull(),
		attempts: integer().default(0).notNull(),
		nextAt: timestamp("next_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		leaseToken: uuid("lease_token"),
		leaseUntil: timestamp("lease_until", {
			withTimezone: true,
			mode: "string",
		}),
		errorCode: text("error_code"),
		runId: text("run_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("integration_jobs_due_idx")
			.using("btree", table.nextAt.asc().nullsLast())
			.where(sql`(status = ANY (ARRAY['pending'::text, 'running'::text]))`),
		unique("integration_jobs_key_key").on(table.key),
		check(
			"integration_jobs_status_check",
			sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])`,
		),
	],
);

export const integrationIdentityAliases = pgTable(
	"integration_identity_aliases",
	{
		alias: text().primaryKey().notNull(),
		canonicalId: text("canonical_id").notNull(),
		kind: text().notNull(),
	},
);

export const integrationOutbox = pgTable(
	"integration_outbox",
	{
		id: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({
			name: "integration_outbox_id_seq",
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: "9223372036854775807",
			cache: 1,
		}),
		resourceKind: text("resource_kind").notNull(),
		resourceId: text("resource_id").notNull(),
		revision: bigint({ mode: "bigint" }).notNull(),
		nameId: uuid("name_id"),
		partnerId: uuid("partner_id"),
		payload: jsonb().notNull(),
		eventType: text("event_type").notNull(),
		recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
			.default(sql`clock_timestamp()`)
			.notNull(),
		published: boolean().default(false).notNull(),
	},
	(table) => [
		index("integration_outbox_pending_idx")
			.using("btree", table.id.asc().nullsLast())
			.where(sql`(NOT published)`),
		index("integration_outbox_retention_idx")
			.on(table.recordedAt, table.id)
			.where(sql`published`),
		unique("integration_outbox_resource_kind_resource_id_revision_key").on(
			table.resourceKind,
			table.resourceId,
			table.revision,
		),
	],
);

export const integrationPublication = pgTable(
	"integration_publication",
	{
		id: integer().primaryKey().notNull(),
		position: bigint({ mode: "bigint" }).default(0n).notNull(),
		minimumPosition: bigint("minimum_position", { mode: "bigint" })
			.default(0n)
			.notNull(),
		deploymentId: text("deployment_id"),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	() => [check("integration_publication_id_check", sql`id = 1`)],
);

export const integrationEvents = pgTable(
	"integration_events",
	{
		position: bigint({ mode: "bigint" }).primaryKey().notNull(),
		id: uuid().defaultRandom().notNull(),
		resourceKind: text("resource_kind").notNull(),
		resourceId: text("resource_id").notNull(),
		revision: bigint({ mode: "bigint" }).notNull(),
		nameId: uuid("name_id"),
		partnerId: uuid("partner_id"),
		eventType: text("event_type").notNull(),
		payload: jsonb().notNull(),
		recordedAt: timestamp("recorded_at", {
			withTimezone: true,
			mode: "string",
		}).notNull(),
		publishedAt: timestamp("published_at", {
			withTimezone: true,
			mode: "string",
		})
			.default(sql`clock_timestamp()`)
			.notNull(),
	},
	(table) => [
		index("integration_events_time_idx").using(
			"btree",
			table.publishedAt.asc().nullsLast(),
			table.position.asc().nullsLast(),
		),
		unique("integration_events_id_key").on(table.id),
		unique("integration_events_resource_kind_resource_id_revision_key").on(
			table.resourceKind,
			table.resourceId,
			table.revision,
		),
	],
);

export const integrationSnapshots = pgTable(
	"integration_snapshots",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		partnerId: uuid("partner_id").notNull(),
		position: bigint({ mode: "bigint" }).notNull(),
		names: uuid().array().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
			.default(sql`(now() + '24:00:00'::interval)`)
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_snapshots_partner_id_fkey",
		}),
	],
);

export const integrationEndpoints = pgTable(
	"integration_endpoints",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		partnerId: uuid("partner_id").notNull(),
		url: text().notNull(),
		configurationVersion: integer("configuration_version").default(1).notNull(),
		status: text().default("unverified").notNull(),
		eventTypes: text("event_types").array().default([]).notNull(),
		secretCiphertext: text("secret_ciphertext").notNull(),
		previousSecretCiphertext: text("previous_secret_ciphertext"),
		previousSecretUntil: timestamp("previous_secret_until", {
			withTimezone: true,
			mode: "string",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_endpoints_partner_id_fkey",
		}),
		check(
			"integration_endpoints_status_check",
			sql`status = ANY (ARRAY['unverified'::text, 'active'::text, 'disabled'::text])`,
		),
	],
);

export const integrationDeliveries = pgTable(
	"integration_deliveries",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		endpointId: uuid("endpoint_id").notNull(),
		partnerId: uuid("partner_id").notNull(),
		eventId: uuid("event_id").notNull(),
		eventPosition: bigint("event_position", { mode: "bigint" }),
		body: text().notNull(),
		configurationVersion: integer("configuration_version").notNull(),
		status: text().default("pending").notNull(),
		attempts: integer().default(0).notNull(),
		nextAt: timestamp("next_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		leaseToken: uuid("lease_token"),
		leaseUntil: timestamp("lease_until", {
			withTimezone: true,
			mode: "string",
		}),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		retryUntil: timestamp("retry_until", { withTimezone: true, mode: "string" })
			.default(sql`(now() + '72:00:00'::interval)`)
			.notNull(),
	},
	(table) => [
		index("integration_deliveries_due_idx")
			.using("btree", table.nextAt.asc().nullsLast())
			.where(sql`(status = ANY (ARRAY['pending'::text, 'running'::text]))`),
		index("integration_deliveries_retention_idx").on(table.createdAt),
		foreignKey({
			columns: [table.endpointId],
			foreignColumns: [integrationEndpoints.id],
			name: "integration_deliveries_endpoint_id_fkey",
		}),
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_deliveries_partner_id_fkey",
		}),
		foreignKey({
			columns: [table.eventPosition],
			foreignColumns: [integrationEvents.position],
			name: "integration_deliveries_event_position_fkey",
		}),
		unique("integration_deliveries_endpoint_id_event_id_key").on(
			table.endpointId,
			table.eventId,
		),
		check(
			"integration_deliveries_status_check",
			sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'paused'::text, 'exhausted'::text])`,
		),
	],
);

export const integrationDeliveryAttempts = pgTable(
	"integration_delivery_attempts",
	{
		id: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({
			name: "integration_delivery_attempts_id_seq",
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: "9223372036854775807",
			cache: 1,
		}),
		deliveryId: uuid("delivery_id").notNull(),
		attemptedAt: timestamp("attempted_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
		httpStatus: integer("http_status"),
		durationMs: integer("duration_ms").notNull(),
		errorCode: text("error_code"),
	},
	(table) => [
		foreignKey({
			columns: [table.deliveryId],
			foreignColumns: [integrationDeliveries.id],
			name: "integration_delivery_attempts_delivery_id_fkey",
		}),
	],
);

export const integrationAudit = pgTable("integration_audit", {
	id: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({
		name: "integration_audit_id_seq",
		startWith: 1,
		increment: 1,
		minValue: 1,
		maxValue: "9223372036854775807",
		cache: 1,
	}),
	actor: text().notNull(),
	action: text().notNull(),
	partnerId: uuid("partner_id"),
	resourceId: text("resource_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
});

export const integrationOperations = pgTable(
	"integration_operations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		partnerId: uuid("partner_id").notNull(),
		kind: text().notNull(),
		nameId: uuid("name_id"),
		status: text().default("pending").notNull(),
		input: jsonb().notNull(),
		result: jsonb(),
		errorCode: text("error_code"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		integrationRevision: bigint("integration_revision", { mode: "bigint" })
			.default(0n)
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_operations_partner_id_fkey",
		}),
		foreignKey({
			columns: [table.nameId],
			foreignColumns: [names.id],
			name: "integration_operations_name_id_fkey",
		}),
		check(
			"integration_operations_kind_check",
			sql`kind = ANY (ARRAY['activation'::text, 'refresh'::text, 'transfer'::text, 'retry'::text, 'endpoint_test'::text, 'endpoint_verify'::text])`,
		),
		check(
			"integration_operations_status_check",
			sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'selection_required'::text])`,
		),
	],
);

export const integrationTransfers = pgTable(
	"integration_transfers",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		partnerId: uuid("partner_id").notNull(),
		nameId: uuid("name_id").notNull(),
		reference: text().notNull(),
		chainId: numeric("chain_id", { precision: 78, scale: 0 }).notNull(),
		transferKind: text("transfer_kind").notNull(),
		attempts: jsonb().notNull(),
		verification: jsonb().notNull().default({}),
		verificationCursor: integer("verification_cursor").notNull().default(0),
		depositId: text("deposit_id"),
		status: text().default("reported").notNull(),
		errorCode: text("error_code"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		integrationRevision: bigint("integration_revision", { mode: "bigint" })
			.default(0n)
			.notNull(),
	},
	(table) => [
		index("integration_transfers_deposit_idx").using(
			"btree",
			table.depositId.asc().nullsLast(),
		),
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_transfers_partner_id_fkey",
		}),
		foreignKey({
			columns: [table.nameId],
			foreignColumns: [names.id],
			name: "integration_transfers_name_id_fkey",
		}),
		unique("integration_transfers_partner_id_reference_key").on(
			table.partnerId,
			table.reference,
		),
		check(
			"integration_transfers_reference_check",
			sql`(length(reference) >= 1) AND (length(reference) <= 255)`,
		),
		check(
			"integration_transfers_transfer_kind_check",
			sql`transfer_kind = ANY (ARRAY['erc20'::text, 'native'::text])`,
		),
	],
);

export const integrationConsumptions = pgTable(
	"integration_consumptions",
	{
		id: text().primaryKey().notNull(),
		nameId: uuid("name_id").notNull(),
		status: text().default("pending").notNull(),
		linkage: text().default("unresolved").notNull(),
		flowIds: uuid("flow_ids").array().default([]).notNull(),
		reason: text(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		integrationRevision: bigint("integration_revision", { mode: "bigint" })
			.default(0n)
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.id],
			foreignColumns: [deposits.eventId],
			name: "integration_consumptions_id_fkey",
		}),
		foreignKey({
			columns: [table.nameId],
			foreignColumns: [names.id],
			name: "integration_consumptions_name_id_fkey",
		}),
	],
);

export const integrationSettlements = pgTable(
	"integration_settlements",
	{
		id: text().primaryKey().notNull(),
		flowId: uuid("flow_id").notNull(),
		nameId: uuid("name_id").notNull(),
		status: text().notNull(),
		evidence: jsonb().notNull(),
		amounts: jsonb().notNull(),
		durationSeconds: numeric("duration_seconds", {
			precision: 78,
			scale: 0,
		}).notNull(),
		expiryAfter: timestamp("expiry_after", {
			withTimezone: true,
			mode: "string",
		}),
		observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		finalizedAt: timestamp("finalized_at", {
			withTimezone: true,
			mode: "string",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		integrationRevision: bigint("integration_revision", { mode: "bigint" })
			.default(0n)
			.notNull(),
	},
	(table) => [
		uniqueIndex("integration_settlements_active_flow_unique")
			.using("btree", table.flowId.asc().nullsLast())
			.where(sql`(status <> 'invalidated'::text)`),
		index("integration_settlements_finality_idx")
			.using("btree", table.updatedAt.asc().nullsLast())
			.where(sql`(status = 'observed'::text)`),
		index("integration_settlements_flow_idx").using(
			"btree",
			table.flowId.asc().nullsLast(),
		),
		foreignKey({
			columns: [table.flowId],
			foreignColumns: [flows.id],
			name: "integration_settlements_flow_id_fkey",
		}),
		foreignKey({
			columns: [table.nameId],
			foreignColumns: [names.id],
			name: "integration_settlements_name_id_fkey",
		}),
		check(
			"integration_settlements_status_check",
			sql`status = ANY (ARRAY['observed'::text, 'finalized'::text, 'invalidated'::text])`,
		),
	],
);

export const integrationEvidence = pgTable(
	"integration_evidence",
	{
		id: text().primaryKey().notNull(),
		chainId: numeric("chain_id", { precision: 78, scale: 0 }).notNull(),
		txHash: text("tx_hash").notNull(),
		blockNumber: numeric("block_number", { precision: 78, scale: 0 }).notNull(),
		blockHash: text("block_hash").notNull(),
		transactionIndex: integer("transaction_index").notNull(),
		logIndex: integer("log_index"),
		transferKind: text("transfer_kind"),
		canonical: boolean().default(true).notNull(),
		receipt: jsonb().notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		integrationRevision: bigint("integration_revision", { mode: "bigint" })
			.default(0n)
			.notNull(),
	},
	(table) => [
		index("integration_evidence_transaction_idx").using(
			"btree",
			table.chainId.asc().nullsLast(),
			table.txHash.asc().nullsLast(),
		),
	],
);

export const integrationAudiences = pgTable(
	"integration_audiences",
	{
		eventPosition: bigint("event_position", { mode: "bigint" }).notNull(),
		partnerId: uuid("partner_id").notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.eventPosition],
			foreignColumns: [integrationEvents.position],
			name: "integration_audiences_event_position_fkey",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_audiences_partner_id_fkey",
		}),
		primaryKey({
			columns: [table.eventPosition, table.partnerId],
			name: "integration_audiences_pkey",
		}),
	],
);

export const integrationWatches = pgTable(
	"integration_watches",
	{
		partnerId: uuid("partner_id").notNull(),
		nameId: uuid("name_id").notNull(),
		enabled: boolean().default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("integration_watches_name_idx")
			.using("btree", table.nameId.asc().nullsLast())
			.where(sql`enabled`),
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_watches_partner_id_fkey",
		}),
		foreignKey({
			columns: [table.nameId],
			foreignColumns: [names.id],
			name: "integration_watches_name_id_fkey",
		}),
		primaryKey({
			columns: [table.partnerId, table.nameId],
			name: "integration_watches_pkey",
		}),
	],
);

export const integrationQuotas = pgTable(
	"integration_quotas",
	{
		partnerId: uuid("partner_id").notNull(),
		bucket: text().notNull(),
		tokens: numeric().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_quotas_partner_id_fkey",
		}),
		primaryKey({
			columns: [table.partnerId, table.bucket],
			name: "integration_quotas_pkey",
		}),
	],
);

export const integrationVersions = pgTable(
	"integration_versions",
	{
		resourceKind: text("resource_kind").notNull(),
		resourceId: text("resource_id").notNull(),
		position: bigint({ mode: "bigint" }).notNull(),
		revision: bigint({ mode: "bigint" }).notNull(),
		nameId: uuid("name_id"),
		partnerId: uuid("partner_id"),
		payload: jsonb().notNull(),
	},
	(table) => [
		index("integration_versions_settlement_flow_idx")
			.on(sql`(payload->>'flowId')`, table.position.desc())
			.where(sql`resource_kind='settlement'`),
		index("integration_versions_latest_idx").on(
			table.resourceKind,
			table.resourceId,
			table.position.desc(),
		),
		index("integration_versions_name_idx").using(
			"btree",
			table.nameId.asc().nullsLast(),
			table.resourceKind.asc().nullsLast(),
			table.resourceId.asc().nullsLast(),
			table.position.desc().nullsFirst(),
		),
		foreignKey({
			columns: [table.position],
			foreignColumns: [integrationEvents.position],
			name: "integration_versions_position_fkey",
		}),
		primaryKey({
			columns: [table.resourceKind, table.resourceId, table.position],
			name: "integration_versions_pkey",
		}),
	],
);

export const integrationIdempotency = pgTable(
	"integration_idempotency",
	{
		partnerId: uuid("partner_id").notNull(),
		route: text().notNull(),
		key: text().notNull(),
		payloadHash: text("payload_hash").notNull(),
		response: jsonb().notNull(),
		statusCode: integer("status_code").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
			.default(sql`(now() + '7 days'::interval)`)
			.notNull(),
	},
	(table) => [
		index("integration_idempotency_expiry_idx").using(
			"btree",
			table.expiresAt.asc().nullsLast(),
		),
		foreignKey({
			columns: [table.partnerId],
			foreignColumns: [integrationPartners.id],
			name: "integration_idempotency_partner_id_fkey",
		}),
		primaryKey({
			columns: [table.partnerId, table.route, table.key],
			name: "integration_idempotency_pkey",
		}),
	],
);

export const integrationCoverage = pgTable(
	"integration_coverage",
	{
		nameId: uuid("name_id").notNull(),
		chainId: numeric("chain_id", { precision: 78, scale: 0 }).notNull(),
		fromBlock: numeric("from_block", { precision: 78, scale: 0 }).notNull(),
		throughBlock: numeric("through_block", { precision: 78, scale: 0 }),
		throughHash: text("through_hash"),
		nativeFrom: numeric("native_from", { precision: 78, scale: 0 }),
		nativeThrough: numeric("native_through", { precision: 78, scale: 0 }),
		nativeTarget: numeric("native_target", { precision: 78, scale: 0 }),
		status: text().default("pending").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		integrationRevision: bigint("integration_revision", { mode: "bigint" })
			.default(0n)
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.nameId],
			foreignColumns: [names.id],
			name: "integration_coverage_name_id_fkey",
		}),
		primaryKey({
			columns: [table.nameId, table.chainId],
			name: "integration_coverage_pkey",
		}),
	],
);

export const integrationCoverageBatches = pgTable(
	"integration_coverage_batches",
	{
		nameId: uuid("name_id")
			.notNull()
			.references(() => names.id),
		chainId: numeric("chain_id", { precision: 78, scale: 0 }).notNull(),
		anchorFrom: numeric("anchor_from", { precision: 78, scale: 0 }).notNull(),
		anchorThrough: numeric("anchor_through", { precision: 78, scale: 0 }),
		fromBlock: numeric("from_block", { precision: 78, scale: 0 }).notNull(),
		toBlock: numeric("to_block", { precision: 78, scale: 0 }).notNull(),
		toHash: text("to_hash").notNull(),
		hashes: text("hashes").array().notNull(),
		nextIndex: integer("next_index").notNull().default(0),
	},
	(t) => [
		primaryKey({
			columns: [t.nameId, t.chainId],
			name: "integration_coverage_batches_pkey",
		}),
	],
);
