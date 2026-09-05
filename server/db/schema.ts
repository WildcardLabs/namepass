import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	customType,
	index,
	integer,
	numeric,
	pgEnum,
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

/**
 * BigInt-safe jsonb. A stored value such as a viem transaction receipt carries
 * BigInt fields, and the default driver serializer is JSON.stringify, which
 * throws "Do not know how to serialize a BigInt". Convert BigInts to decimal
 * strings at the driver boundary so every jsonb column is safe to write.
 */
export function serializeJsonb(value: unknown): string {
	return JSON.stringify(value, (_key, item: unknown) =>
		typeof item === "bigint" ? item.toString(10) : item,
	);
}

const jsonb = customType<{ data: unknown }>({
	dataType() {
		return "jsonb";
	},
	toDriver(value) {
		return serializeJsonb(value);
	},
	fromDriver(value) {
		if (typeof value === "string") {
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}
		}
		return value;
	},
});

const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });
const instant = (name: string) =>
	timestamp(name, { withTimezone: true, precision: 3 });

export const renewableBy = pgEnum("renewable_by", ["registrar", "v1"]);
export const eventFamily = pgEnum("event_family", [
	"deposit",
	"namepass",
	"circle",
	"ens",
]);
export const depositSource = pgEnum("deposit_source", [
	"goldsky",
	"balance_recovery",
]);
export const depositStatus = pgEnum("deposit_status", [
	"detected",
	"finalized",
	"orphaned",
]);
export const flowTrigger = pgEnum("flow_trigger", [
	"automatic",
	"manual",
	"recovery",
	"external",
]);
export const flowStatus = pgEnum("flow_status", [
	"queued",
	"confirming_deposit",
	"checking_name",
	"submitting_origin",
	"waiting_origin",
	"waiting_attestation",
	"submitting_claim",
	"waiting_claim",
	"held",
	"unclaimed",
	"settled",
	"cancelled",
	"failed",
]);
export const transactionKind = pgEnum("transaction_kind", [
	"origin_renew",
	"claim",
]);

export const names = pgTable(
	"names",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		normalizedLabel: varchar("normalized_label", { length: 255 }).notNull(),
		displayName: text("display_name").notNull(),
		labelHash: varchar("label_hash", { length: 66 }).notNull(),
		namehash: varchar("namehash", { length: 66 }).notNull(),
		depositAddress: varchar("deposit_address", { length: 42 }).notNull(),
		activatedAt: instant("activated_at").defaultNow().notNull(),
		currentExpiry: instant("current_expiry"),
		renewableBy: renewableBy("renewable_by"),
		ensSyncedAt: instant("ens_synced_at").notNull(),
		unscannedChainIds: amount("unscanned_chain_ids")
			.array()
			.default(sql`'{}'::numeric[]`)
			.notNull(),
		lifetimeReceived: amount("lifetime_received").default("0").notNull(),
		lifetimeApplied: amount("lifetime_applied").default("0").notNull(),
		timeDeliveredSeconds: amount("time_delivered_seconds").default("0").notNull(),
		renewalCount: bigint("renewal_count", { mode: "bigint" })
			.default(sql`0`)
			.notNull(),
	},
	(table) => [
		unique("names_normalized_label_unique").on(table.normalizedLabel),
		unique("names_label_hash_unique").on(table.labelHash),
		unique("names_deposit_address_unique").on(table.depositAddress),
		index("names_lifetime_received_idx").on(table.lifetimeReceived),
		index("names_time_delivered_seconds_idx").on(table.timeDeliveredSeconds),
	],
);

export const goldsky = pgSchema("goldsky");

export const watchedAddresses = goldsky.table("watched_addresses", {
	value: varchar("value", { length: 42 }).primaryKey(),
	updatedAt: instant("updated_at").defaultNow().notNull(),
});

/**
 * One authoritative chain snapshot per activated name and chain. Public reads
 * apply canonical indexed events after this block. They do not call chain RPC.
 */
export const balanceSnapshots = pgTable(
	"balance_snapshots",
	{
		nameId: uuid("name_id")
			.notNull()
			.references(() => names.id),
		chainId: amount("chain_id").notNull(),
		amount: amount("amount").notNull(),
		blockNumber: amount("block_number").notNull(),
		updatedAt: instant("updated_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.nameId, table.chainId] }),
		index("balance_snapshots_chain_idx").on(table.chainId),
	],
);

export const chainEvents = pgTable(
	"chain_events",
	{
		eventId: text("event_id").primaryKey(),
		eventFamily: eventFamily("event_family").notNull(),
		eventType: text("event_type").notNull(),
		chainId: amount("chain_id").notNull(),
		txHash: varchar("tx_hash", { length: 66 }).notNull(),
		logIndex: integer("log_index").notNull(),
		blockNumber: amount("block_number").notNull(),
		blockTime: instant("block_time").notNull(),
		gsOp: text("gs_op").notNull(),
		canonical: boolean("canonical").default(true).notNull(),
		facts: jsonb("facts").notNull(),
		payload: jsonb("payload"),
		payloadExpiresAt: instant("payload_expires_at"),
		firstSeenAt: instant("first_seen_at").defaultNow().notNull(),
		lastSeenAt: instant("last_seen_at").defaultNow().notNull(),
	},
	(table) => [
		unique("chain_events_chain_log_type_unique").on(
			table.chainId,
			table.txHash,
			table.logIndex,
			table.eventType,
		),
		index("chain_events_canonical_time_idx").on(
			table.canonical,
			table.blockTime,
		),
		index("chain_events_payload_expiry_idx").on(table.payloadExpiresAt),
	],
);

export const deposits = pgTable(
	"deposits",
	{
		eventId: text("event_id")
			.primaryKey()
			.references(() => chainEvents.eventId),
		nameId: uuid("name_id")
			.notNull()
			.references(() => names.id),
		chainId: amount("chain_id").notNull(),
		tokenAddress: varchar("token_address", { length: 42 }).notNull(),
		senderAddress: varchar("sender_address", { length: 42 }),
		amount: amount("amount").notNull(),
		txHash: varchar("tx_hash", { length: 66 }).notNull(),
		logIndex: integer("log_index").notNull(),
		blockNumber: amount("block_number").notNull(),
		blockTime: instant("block_time").notNull(),
		source: depositSource("source").notNull(),
		status: depositStatus("status").notNull(),
	},
	(table) => [
		index("deposits_name_time_idx").on(table.nameId, table.blockTime),
		index("deposits_chain_time_idx").on(table.chainId, table.blockTime),
	],
);

export const flows = pgTable(
	"flows",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		nameId: uuid("name_id")
			.notNull()
			.references(() => names.id),
		depositEventId: text("deposit_event_id").references(() => deposits.eventId),
		renewalEventId: text("renewal_event_id").references(() => chainEvents.eventId),
		originChainId: amount("origin_chain_id").notNull(),
		trigger: flowTrigger("trigger").notNull(),
		status: flowStatus("status").default("queued").notNull(),
		holdReason: text("hold_reason"),
		workflowRunId: text("workflow_run_id"),
		originTxIntentId: uuid("origin_tx_intent_id"),
		originEventId: text("origin_event_id").references(() => chainEvents.eventId),
		originEvidenceTxHash: varchar("origin_evidence_tx_hash", { length: 66 }),
		claimTxIntentId: uuid("claim_tx_intent_id"),
		amountDetected: amount("amount_detected").notNull(),
		amountProcessed: amount("amount_processed"),
		remainingAmount: amount("remaining_amount"),
		gasAllowance: amount("gas_allowance"),
		amountApplied: amount("amount_applied"),
		durationSeconds: amount("duration_seconds"),
		expiryAfter: instant("expiry_after"),
		cctpNonce: amount("cctp_nonce"),
		cctpMessageIndex: integer("cctp_message_index"),
		cctpMessage: text("cctp_message"),
		cctpAttestation: text("cctp_attestation"),
		lastErrorCode: text("last_error_code"),
		lastErrorDetail: text("last_error_detail"),
		nextActionAt: instant("next_action_at"),
		queuedAt: instant("queued_at").defaultNow().notNull(),
		confirmingDepositAt: instant("confirming_deposit_at"),
		checkingNameAt: instant("checking_name_at"),
		submittingOriginAt: instant("submitting_origin_at"),
		waitingOriginAt: instant("waiting_origin_at"),
		waitingAttestationAt: instant("waiting_attestation_at"),
		submittingClaimAt: instant("submitting_claim_at"),
		waitingClaimAt: instant("waiting_claim_at"),
		heldAt: instant("held_at"),
		unclaimedAt: instant("unclaimed_at"),
		settledAt: instant("settled_at"),
		cancelledAt: instant("cancelled_at"),
		failedAt: instant("failed_at"),
		createdAt: instant("created_at").defaultNow().notNull(),
		updatedAt: instant("updated_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("flows_one_active_per_name_chain")
			.on(table.nameId, table.originChainId)
			.where(sql`${table.originEventId} is null and ${table.status} in ('queued', 'confirming_deposit', 'checking_name', 'submitting_origin', 'waiting_origin', 'held')`),
		uniqueIndex("flows_deposit_event_unique")
			.on(table.depositEventId)
			.where(sql`${table.depositEventId} is not null`),
		uniqueIndex("flows_renewal_event_unique")
			.on(table.renewalEventId)
			.where(sql`${table.renewalEventId} is not null`),
		uniqueIndex("flows_workflow_run_unique")
			.on(table.workflowRunId)
			.where(sql`${table.workflowRunId} is not null`),
		uniqueIndex("flows_origin_event_unique")
			.on(table.originEventId)
			.where(sql`${table.originEventId} is not null`),
		uniqueIndex("flows_cctp_nonce_unique")
			.on(table.originChainId, table.cctpNonce)
			.where(sql`${table.cctpNonce} is not null`),
		check(
			"flows_cctp_message_index_nonnegative",
			sql`${table.cctpMessageIndex} is null or ${table.cctpMessageIndex} >= 0`,
		),
		index("flows_name_created_idx").on(table.nameId, table.createdAt),
		index("flows_status_action_idx").on(table.status, table.nextActionAt),
	],
);

export const flowTransitions = pgTable(
	"flow_transitions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		flowId: uuid("flow_id")
			.notNull()
			.references(() => flows.id),
		fromStatus: flowStatus("from_status"),
		toStatus: flowStatus("to_status").notNull(),
		actor: text("actor").notNull(),
		reasonCode: text("reason_code"),
		detail: jsonb("detail"),
		createdAt: instant("created_at").defaultNow().notNull(),
	},
	(table) => [index("flow_transitions_flow_created_idx").on(table.flowId, table.createdAt)],
);

export const relayerNonces = pgTable(
	"relayer_nonces",
	{
		chainId: amount("chain_id").notNull(),
		relayerAddress: varchar("relayer_address", { length: 42 }).notNull(),
		nextNonce: amount("next_nonce").notNull(),
		updatedAt: instant("updated_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({
			name: "relayer_nonces_chain_relayer_pk",
			columns: [table.chainId, table.relayerAddress],
		}),
	],
);

export const transactionIntents = pgTable(
	"transaction_intents",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		flowId: uuid("flow_id")
			.notNull()
			.references(() => flows.id),
		kind: transactionKind("kind").notNull(),
		chainId: amount("chain_id").notNull(),
		fromAddress: varchar("from_address", { length: 42 }).notNull(),
		toAddress: varchar("to_address", { length: 42 }).notNull(),
		nonce: amount("nonce").notNull(),
		callData: text("call_data").notNull(),
		value: amount("value").default("0").notNull(),
		gasLimit: amount("gas_limit"),
		maxFeePerGas: amount("max_fee_per_gas"),
		maxPriorityFeePerGas: amount("max_priority_fee_per_gas"),
		gasPrice: amount("gas_price"),
		currentRawTransaction: text("current_raw_transaction"),
		currentTxHash: varchar("current_tx_hash", { length: 66 }),
		attempts: jsonb("attempts").default(sql`'[]'::jsonb`).notNull(),
		status: text("status").notNull(),
		broadcastAt: instant("broadcast_at"),
		lastBroadcastAttemptAt: instant("last_broadcast_attempt_at"),
		pendingWarnedAt: instant("pending_warned_at"),
		confirmedAt: instant("confirmed_at"),
		receipt: jsonb("receipt"),
		error: jsonb("error"),
		createdAt: instant("created_at").defaultNow().notNull(),
		updatedAt: instant("updated_at").defaultNow().notNull(),
	},
	(table) => [
		unique("transaction_intents_flow_kind_unique").on(table.flowId, table.kind),
		unique("transaction_intents_nonce_owner_unique").on(
			table.chainId,
			table.fromAddress,
			table.nonce,
		),
		index("transaction_intents_lane_status_nonce_idx").on(
			table.chainId,
			table.fromAddress,
			table.status,
			table.nonce,
		),
	],
);
