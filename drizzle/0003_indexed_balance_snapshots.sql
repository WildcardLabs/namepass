CREATE TABLE "balance_snapshots" (
	"name_id" uuid NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_snapshots_name_id_chain_id_pk" PRIMARY KEY("name_id","chain_id")
);
--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_name_id_names_id_fk" FOREIGN KEY ("name_id") REFERENCES "public"."names"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshots_chain_idx" ON "balance_snapshots" USING btree ("chain_id");