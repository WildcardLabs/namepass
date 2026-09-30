// Internal receipt and finality evidence for public transaction polling.
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
	numeric,
	uniqueIndex,
	primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
	},
	(table) => [
		index("integration_evidence_transaction_idx").using(
			"btree",
			table.chainId.asc().nullsLast(),
			table.txHash.asc().nullsLast(),
		),
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
