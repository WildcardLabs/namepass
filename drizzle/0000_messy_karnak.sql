CREATE SCHEMA "goldsky";
--> statement-breakpoint
CREATE TYPE "public"."deposit_source" AS ENUM('goldsky', 'balance_recovery');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('detected', 'finalized', 'orphaned');--> statement-breakpoint
CREATE TYPE "public"."event_family" AS ENUM('deposit', 'namepass', 'circle', 'ens');--> statement-breakpoint
CREATE TYPE "public"."flow_status" AS ENUM('queued', 'confirming_deposit', 'checking_name', 'submitting_origin', 'waiting_origin', 'waiting_attestation', 'submitting_claim', 'waiting_claim', 'held', 'unclaimed', 'settled', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flow_trigger" AS ENUM('automatic', 'manual', 'recovery', 'external');--> statement-breakpoint
CREATE TYPE "public"."renewable_by" AS ENUM('registrar', 'v1');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('origin_renew', 'claim');--> statement-breakpoint
CREATE TABLE "chain_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_family" "event_family" NOT NULL,
	"event_type" text NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_time" timestamp (3) with time zone NOT NULL,
	"gs_op" text NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"facts" jsonb NOT NULL,
	"payload" jsonb,
	"payload_expires_at" timestamp (3) with time zone,
	"first_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_chain_log_type_unique" UNIQUE("chain_id","tx_hash","log_index","event_type")
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"event_id" text PRIMARY KEY NOT NULL,
	"name_id" uuid NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"sender_address" varchar(42),
	"amount" numeric(78, 0) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_time" timestamp (3) with time zone NOT NULL,
	"source" "deposit_source" NOT NULL,
	"status" "deposit_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"from_status" "flow_status",
	"to_status" "flow_status" NOT NULL,
	"actor" text NOT NULL,
	"reason_code" text,
	"detail" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_id" uuid NOT NULL,
	"deposit_event_id" text,
	"renewal_event_id" text,
	"origin_chain_id" numeric(78, 0) NOT NULL,
	"trigger" "flow_trigger" NOT NULL,
	"status" "flow_status" DEFAULT 'queued' NOT NULL,
	"hold_reason" text,
	"workflow_run_id" text,
	"origin_tx_intent_id" uuid,
	"claim_tx_intent_id" uuid,
	"amount_detected" numeric(78, 0) NOT NULL,
	"amount_processed" numeric(78, 0),
	"remaining_amount" numeric(78, 0),
	"gas_allowance" numeric(78, 0),
	"amount_applied" numeric(78, 0),
	"duration_seconds" numeric(78, 0),
	"cctp_nonce" numeric(78, 0),
	"cctp_message" text,
	"cctp_attestation" text,
	"last_error_code" text,
	"last_error_detail" text,
	"next_action_at" timestamp (3) with time zone,
	"queued_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"confirming_deposit_at" timestamp (3) with time zone,
	"checking_name_at" timestamp (3) with time zone,
	"submitting_origin_at" timestamp (3) with time zone,
	"waiting_origin_at" timestamp (3) with time zone,
	"waiting_attestation_at" timestamp (3) with time zone,
	"submitting_claim_at" timestamp (3) with time zone,
	"waiting_claim_at" timestamp (3) with time zone,
	"held_at" timestamp (3) with time zone,
	"unclaimed_at" timestamp (3) with time zone,
	"settled_at" timestamp (3) with time zone,
	"cancelled_at" timestamp (3) with time zone,
	"failed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_label" varchar(255) NOT NULL,
	"display_name" text NOT NULL,
	"label_hash" varchar(66) NOT NULL,
	"namehash" varchar(66) NOT NULL,
	"deposit_address" varchar(42) NOT NULL,
	"activated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"current_expiry" timestamp (3) with time zone,
	"renewable_by" "renewable_by",
	"ens_synced_at" timestamp (3) with time zone NOT NULL,
	"unscanned_chain_ids" numeric(78, 0)[] DEFAULT '{}'::numeric[] NOT NULL,
	"lifetime_received" numeric(78, 0) DEFAULT '0' NOT NULL,
	"lifetime_applied" numeric(78, 0) DEFAULT '0' NOT NULL,
	"time_delivered_seconds" numeric(78, 0) DEFAULT '0' NOT NULL,
	"renewal_count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "names_normalized_label_unique" UNIQUE("normalized_label"),
	CONSTRAINT "names_label_hash_unique" UNIQUE("label_hash"),
	CONSTRAINT "names_deposit_address_unique" UNIQUE("deposit_address")
);
--> statement-breakpoint
CREATE TABLE "relayer_nonces" (
	"chain_id" numeric(78, 0) NOT NULL,
	"relayer_address" varchar(42) NOT NULL,
	"next_nonce" numeric(78, 0) NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relayer_nonces_chain_relayer_pk" PRIMARY KEY("chain_id","relayer_address")
);
--> statement-breakpoint
CREATE TABLE "transaction_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"call_data" text NOT NULL,
	"value" numeric(78, 0) DEFAULT '0' NOT NULL,
	"gas_limit" numeric(78, 0),
	"max_fee_per_gas" numeric(78, 0),
	"max_priority_fee_per_gas" numeric(78, 0),
	"gas_price" numeric(78, 0),
	"current_raw_transaction" text,
	"current_tx_hash" varchar(66),
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"broadcast_at" timestamp (3) with time zone,
	"confirmed_at" timestamp (3) with time zone,
	"receipt" jsonb,
	"error" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_intents_flow_kind_unique" UNIQUE("flow_id","kind"),
	CONSTRAINT "transaction_intents_nonce_owner_unique" UNIQUE("chain_id","from_address","nonce")
);
--> statement-breakpoint
CREATE TABLE "goldsky"."watched_addresses" (
	"value" varchar(42) PRIMARY KEY NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_event_id_chain_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_name_id_names_id_fk" FOREIGN KEY ("name_id") REFERENCES "public"."names"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_transitions" ADD CONSTRAINT "flow_transitions_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_name_id_names_id_fk" FOREIGN KEY ("name_id") REFERENCES "public"."names"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_deposit_event_id_deposits_event_id_fk" FOREIGN KEY ("deposit_event_id") REFERENCES "public"."deposits"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_renewal_event_id_chain_events_event_id_fk" FOREIGN KEY ("renewal_event_id") REFERENCES "public"."chain_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_events_canonical_time_idx" ON "chain_events" USING btree ("canonical","block_time");--> statement-breakpoint
CREATE INDEX "chain_events_payload_expiry_idx" ON "chain_events" USING btree ("payload_expires_at");--> statement-breakpoint
CREATE INDEX "deposits_name_time_idx" ON "deposits" USING btree ("name_id","block_time");--> statement-breakpoint
CREATE INDEX "deposits_chain_time_idx" ON "deposits" USING btree ("chain_id","block_time");--> statement-breakpoint
CREATE INDEX "flow_transitions_flow_created_idx" ON "flow_transitions" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_one_active_per_name_chain" ON "flows" USING btree ("name_id","origin_chain_id") WHERE "flows"."status" not in ('settled', 'cancelled', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "flows_deposit_event_unique" ON "flows" USING btree ("deposit_event_id") WHERE "flows"."deposit_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "flows_renewal_event_unique" ON "flows" USING btree ("renewal_event_id") WHERE "flows"."renewal_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "flows_workflow_run_unique" ON "flows" USING btree ("workflow_run_id") WHERE "flows"."workflow_run_id" is not null;--> statement-breakpoint
CREATE INDEX "flows_name_created_idx" ON "flows" USING btree ("name_id","created_at");--> statement-breakpoint
CREATE INDEX "flows_status_action_idx" ON "flows" USING btree ("status","next_action_at");--> statement-breakpoint
CREATE INDEX "names_lifetime_received_idx" ON "names" USING btree ("lifetime_received");--> statement-breakpoint
CREATE INDEX "names_time_delivered_seconds_idx" ON "names" USING btree ("time_delivered_seconds");