-- Preserve native transaction identity separately from ERC-20 log identity.
ALTER TABLE chain_events ADD COLUMN evidence_kind text NOT NULL DEFAULT 'log';
ALTER TABLE deposits ADD COLUMN transfer_kind text NOT NULL DEFAULT 'erc20';
UPDATE chain_events SET evidence_kind='native' WHERE event_id LIKE '%:native:%';
UPDATE deposits SET transfer_kind='native' WHERE event_id LIKE '%:native:%';
ALTER TABLE chain_events DROP CONSTRAINT chain_events_chain_log_type_unique;
ALTER TABLE chain_events ADD CONSTRAINT chain_events_chain_log_type_unique UNIQUE(chain_id,tx_hash,log_index,event_type,evidence_kind);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM deposits a JOIN deposits b ON a.chain_id=b.chain_id AND a.tx_hash=b.tx_hash AND a.name_id=b.name_id
   AND a.sender_address=b.sender_address AND a.amount=b.amount WHERE a.transfer_kind='native' AND b.transfer_kind='erc20')
 THEN RAISE EXCEPTION 'Native/token duplicate candidates require receipt reconciliation before integration migration'; END IF;
END $$;
-- Additive integration journal. No hosted reset and no payment execution queue.
CREATE TABLE integration_partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 enabled boolean NOT NULL DEFAULT true, read_rate integer NOT NULL DEFAULT 10 CHECK(read_rate BETWEEN 1 AND 1000),
 write_rate integer NOT NULL DEFAULT 60 CHECK(write_rate BETWEEN 1 AND 6000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES integration_partners(id),
 prefix text NOT NULL UNIQUE, digest text NOT NULL UNIQUE, scopes text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE integration_watches (
 partner_id uuid NOT NULL REFERENCES integration_partners(id), name_id uuid NOT NULL REFERENCES names(id),
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(partner_id,name_id)
);
CREATE INDEX integration_watches_name_idx ON integration_watches(name_id) WHERE enabled;
CREATE TABLE integration_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES integration_partners(id),
 kind text NOT NULL CHECK(kind IN ('activation','refresh','transfer','retry','endpoint_test','endpoint_verify')),
 name_id uuid REFERENCES names(id), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','selection_required')),
 input jsonb NOT NULL, result jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES integration_partners(id),
 name_id uuid NOT NULL REFERENCES names(id), reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 255),
 chain_id numeric(78,0) NOT NULL, transfer_kind text NOT NULL CHECK(transfer_kind IN ('erc20','native')),
 attempts jsonb NOT NULL, verification jsonb NOT NULL DEFAULT '{}', verification_cursor integer NOT NULL DEFAULT 0, deposit_id text, status text NOT NULL DEFAULT 'reported', error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(partner_id,reference)
);
CREATE INDEX integration_transfers_deposit_idx ON integration_transfers(deposit_id);
CREATE TABLE integration_idempotency (
 partner_id uuid NOT NULL REFERENCES integration_partners(id), route text NOT NULL, key text NOT NULL,
 payload_hash text NOT NULL, response jsonb NOT NULL, status_code integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 PRIMARY KEY(partner_id,route,key)
);
CREATE INDEX integration_idempotency_expiry_idx ON integration_idempotency(expires_at);
CREATE TABLE integration_quotas (partner_id uuid NOT NULL REFERENCES integration_partners(id), bucket text NOT NULL,
 tokens numeric NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(partner_id,bucket));
CREATE TABLE integration_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, kind text NOT NULL,
 input jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 error_code text, run_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_jobs_due_idx ON integration_jobs(next_at) WHERE status IN ('pending','running');
CREATE TABLE integration_coverage (
 name_id uuid NOT NULL REFERENCES names(id), chain_id numeric(78,0) NOT NULL, from_block numeric(78,0) NOT NULL,
 through_block numeric(78,0), through_hash text, native_from numeric(78,0), native_through numeric(78,0), native_target numeric(78,0), status text NOT NULL DEFAULT 'pending', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(name_id,chain_id)
);
CREATE TABLE integration_evidence (
 id text PRIMARY KEY, chain_id numeric(78,0) NOT NULL, tx_hash text NOT NULL, block_number numeric(78,0) NOT NULL,
 block_hash text NOT NULL, transaction_index integer NOT NULL, log_index integer, transfer_kind text,
 canonical boolean NOT NULL DEFAULT true, receipt jsonb NOT NULL, verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_evidence_transaction_idx ON integration_evidence(chain_id,tx_hash);
CREATE TABLE integration_identity_aliases (alias text PRIMARY KEY, canonical_id text NOT NULL, kind text NOT NULL);
CREATE TABLE integration_consumptions (
 id text PRIMARY KEY REFERENCES deposits(event_id), name_id uuid NOT NULL REFERENCES names(id),
 status text NOT NULL DEFAULT 'pending', linkage text NOT NULL DEFAULT 'unresolved', flow_ids uuid[] NOT NULL DEFAULT '{}',
 reason text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_settlements (
 id text PRIMARY KEY, flow_id uuid NOT NULL REFERENCES flows(id), name_id uuid NOT NULL REFERENCES names(id),
 status text NOT NULL CHECK(status IN ('observed','finalized','invalidated')),
 evidence jsonb NOT NULL, amounts jsonb NOT NULL, duration_seconds numeric(78,0) NOT NULL,
 expiry_after timestamptz, observed_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_settlements_flow_idx ON integration_settlements(flow_id);
CREATE INDEX integration_settlements_finality_idx ON integration_settlements(updated_at) WHERE status='observed';
CREATE TABLE integration_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, resource_kind text NOT NULL, resource_id text NOT NULL,
 revision bigint NOT NULL, name_id uuid, partner_id uuid, payload jsonb NOT NULL, event_type text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), published boolean NOT NULL DEFAULT false,
 UNIQUE(resource_kind,resource_id,revision)
);
CREATE INDEX integration_outbox_pending_idx ON integration_outbox(id) WHERE NOT published;
CREATE INDEX integration_outbox_retention_idx ON integration_outbox(recorded_at,id) WHERE published;
CREATE TABLE integration_publication (
 id integer PRIMARY KEY CHECK(id=1), position bigint NOT NULL DEFAULT 0, minimum_position bigint NOT NULL DEFAULT 0,
 deployment_id text, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO integration_publication(id) VALUES(1);
CREATE TABLE integration_events (
 position bigint PRIMARY KEY, id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), resource_kind text NOT NULL,
 resource_id text NOT NULL, revision bigint NOT NULL, name_id uuid, partner_id uuid, event_type text NOT NULL,
 payload jsonb NOT NULL, recorded_at timestamptz NOT NULL, published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(resource_kind,resource_id,revision)
);
CREATE INDEX integration_events_time_idx ON integration_events(published_at,position);
CREATE TABLE integration_audiences (
 event_position bigint NOT NULL REFERENCES integration_events(position) ON DELETE CASCADE,
 partner_id uuid NOT NULL REFERENCES integration_partners(id), PRIMARY KEY(partner_id,event_position)
);
CREATE TABLE integration_versions (
 resource_kind text NOT NULL, resource_id text NOT NULL, position bigint NOT NULL REFERENCES integration_events(position),
 revision bigint NOT NULL, name_id uuid, partner_id uuid, payload jsonb NOT NULL,
 PRIMARY KEY(resource_kind,resource_id,position)
);
CREATE INDEX integration_versions_name_idx ON integration_versions(name_id,resource_kind,resource_id,position DESC);
CREATE INDEX integration_versions_latest_idx ON integration_versions(resource_kind,resource_id,position DESC);
CREATE INDEX integration_versions_settlement_flow_idx ON integration_versions((payload->>'flowId'),position DESC) WHERE resource_kind='settlement';
CREATE TABLE integration_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES integration_partners(id),
 position bigint NOT NULL, names uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE TABLE integration_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES integration_partners(id),
 url text NOT NULL, configuration_version integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'unverified'
 CHECK(status IN ('unverified','active','disabled')), event_types text[] NOT NULL DEFAULT '{}',
 secret_ciphertext text NOT NULL, previous_secret_ciphertext text, previous_secret_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint_id uuid NOT NULL REFERENCES integration_endpoints(id),
 partner_id uuid NOT NULL REFERENCES integration_partners(id), event_id uuid NOT NULL,
 event_position bigint REFERENCES integration_events(position), body text NOT NULL, configuration_version integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','paused','exhausted')),
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 retry_until timestamptz NOT NULL DEFAULT now()+interval '72 hours', UNIQUE(endpoint_id,event_id)
);
CREATE INDEX integration_deliveries_due_idx ON integration_deliveries(next_at) WHERE status IN ('pending','running');
CREATE INDEX integration_deliveries_retention_idx ON integration_deliveries(created_at);
CREATE TABLE integration_delivery_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, delivery_id uuid NOT NULL REFERENCES integration_deliveries(id),
 attempted_at timestamptz NOT NULL DEFAULT now(), http_status integer, duration_ms integer NOT NULL, error_code text
);
CREATE TABLE integration_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 partner_id uuid, resource_id text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION integration_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.integration_revision := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.integration_revision+1 END; RETURN NEW; END $$;

ALTER TABLE names ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON names FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_names() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'name.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.id::text; r := NEW.integration_revision;
 p := jsonb_build_object('label', NEW.normalized_label, 'name', NEW.display_name, 'depositAddress', NEW.deposit_address, 'activatedAt', NEW.activated_at, 'currentExpiry', NEW.current_expiry, 'renewableBy', NEW.renewable_by, 'ensSyncedAt', NEW.ens_synced_at, 'unscannedChainIds', ARRAY(SELECT x::text FROM unnest(NEW.unscanned_chain_ids) x), 'lifetimeReceived', NEW.lifetime_received::text, 'lifetimeApplied', NEW.lifetime_applied::text, 'timeDeliveredSeconds', NEW.time_delivered_seconds::text, 'renewalCount', NEW.renewal_count::text);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('label', OLD.normalized_label, 'name', OLD.display_name, 'depositAddress', OLD.deposit_address, 'activatedAt', OLD.activated_at, 'currentExpiry', OLD.current_expiry, 'renewableBy', OLD.renewable_by, 'ensSyncedAt', OLD.ens_synced_at, 'unscannedChainIds', ARRAY(SELECT x::text FROM unnest(OLD.unscanned_chain_ids) x), 'lifetimeReceived', OLD.lifetime_received::text, 'lifetimeApplied', OLD.lifetime_applied::text, 'timeDeliveredSeconds', OLD.time_delivered_seconds::text, 'renewalCount', OLD.renewal_count::text); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='name.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('name',resource_id,r,NEW.id,NULL,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON names
 FOR EACH ROW EXECUTE FUNCTION integration_capture_names();

ALTER TABLE deposits ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON deposits FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_deposits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'deposit.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.event_id; r := NEW.integration_revision;
 p := jsonb_build_object('nameId', NEW.name_id, 'chainId', NEW.chain_id::text, 'tokenAddress', NEW.token_address, 'senderAddress', NEW.sender_address, 'amount', NEW.amount::text, 'txHash', NEW.tx_hash, 'transferKind', NEW.transfer_kind, 'logIndex', CASE WHEN NEW.transfer_kind='native' THEN NULL ELSE NEW.log_index END, 'blockNumber', NEW.block_number::text, 'blockTime', NEW.block_time, 'observationStatus', NEW.status);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('nameId', OLD.name_id, 'chainId', OLD.chain_id::text, 'tokenAddress', OLD.token_address, 'senderAddress', OLD.sender_address, 'amount', OLD.amount::text, 'txHash', OLD.tx_hash, 'transferKind', OLD.transfer_kind, 'logIndex', CASE WHEN OLD.transfer_kind='native' THEN NULL ELSE OLD.log_index END, 'blockNumber', OLD.block_number::text, 'blockTime', OLD.block_time, 'observationStatus', OLD.status); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='deposit.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('deposit',resource_id,r,NEW.name_id,NULL,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON deposits
 FOR EACH ROW EXECUTE FUNCTION integration_capture_deposits();

ALTER TABLE flows ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON flows FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_flows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'flow.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.id::text; r := NEW.integration_revision;
 p := jsonb_build_object('nameId', NEW.name_id, 'originChainId', NEW.origin_chain_id::text, 'executionStatus', NEW.status, 'status', CASE WHEN NEW.status='settled' AND NOT EXISTS(SELECT 1 FROM integration_settlements verified WHERE verified.flow_id=NEW.id AND verified.status IN ('observed','finalized')) THEN 'verifying_settlement' ELSE NEW.status::text END, 'trigger', NEW.trigger, 'holdReason', NEW.hold_reason, 'amountDetected', NEW.amount_detected::text, 'amountProcessed', NEW.amount_processed::text, 'originWalletRemainder', NEW.remaining_amount::text, 'executorAllowance', NEW.gas_allowance::text, 'amountApplied', NEW.amount_applied::text, 'durationSeconds', NEW.duration_seconds::text, 'expiryAfter', NEW.expiry_after, 'depositId', NEW.deposit_event_id, 'originEventId', NEW.origin_event_id, 'renewalEventId', NEW.renewal_event_id, 'originTxHash', NEW.origin_evidence_tx_hash, 'cctpNonce', NEW.cctp_nonce::text, 'reasonCode', NEW.last_error_code, 'nextActionAt', NEW.next_action_at, 'createdAt', NEW.created_at, 'settledAt', NEW.settled_at);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('nameId', OLD.name_id, 'originChainId', OLD.origin_chain_id::text, 'executionStatus', OLD.status, 'status', CASE WHEN OLD.status='settled' AND NOT EXISTS(SELECT 1 FROM integration_settlements verified WHERE verified.flow_id=OLD.id AND verified.status IN ('observed','finalized')) THEN 'verifying_settlement' ELSE OLD.status::text END, 'trigger', OLD.trigger, 'holdReason', OLD.hold_reason, 'amountDetected', OLD.amount_detected::text, 'amountProcessed', OLD.amount_processed::text, 'originWalletRemainder', OLD.remaining_amount::text, 'executorAllowance', OLD.gas_allowance::text, 'amountApplied', OLD.amount_applied::text, 'durationSeconds', OLD.duration_seconds::text, 'expiryAfter', OLD.expiry_after, 'depositId', OLD.deposit_event_id, 'originEventId', OLD.origin_event_id, 'renewalEventId', OLD.renewal_event_id, 'originTxHash', OLD.origin_evidence_tx_hash, 'cctpNonce', OLD.cctp_nonce::text, 'reasonCode', OLD.last_error_code, 'nextActionAt', OLD.next_action_at, 'createdAt', OLD.created_at, 'settledAt', OLD.settled_at); IF p=old_p AND NEW.status<>'settled' THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='flow.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('flow',resource_id,r,NEW.name_id,NULL,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON flows
 FOR EACH ROW EXECUTE FUNCTION integration_capture_flows();

ALTER TABLE balance_snapshots ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON balance_snapshots FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_balance_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'balance.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.name_id::text || ':' || NEW.chain_id::text; r := NEW.integration_revision;
 p := jsonb_build_object('nameId', NEW.name_id, 'chainId', NEW.chain_id::text, 'snapshotAmount', NEW.amount::text, 'snapshotBlock', NEW.block_number::text);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('nameId', OLD.name_id, 'chainId', OLD.chain_id::text, 'snapshotAmount', OLD.amount::text, 'snapshotBlock', OLD.block_number::text); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='balance.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('balance',resource_id,r,NEW.name_id,NULL,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON balance_snapshots
 FOR EACH ROW EXECUTE FUNCTION integration_capture_balance_snapshots();

ALTER TABLE integration_operations ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON integration_operations FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_integration_operations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'activation.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.id::text; r := NEW.integration_revision;
 p := jsonb_build_object('kind', NEW.kind, 'nameId', NEW.name_id, 'status', NEW.status, 'result', NEW.result, 'reasonCode', NEW.error_code, 'createdAt', NEW.created_at);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('kind', OLD.kind, 'nameId', OLD.name_id, 'status', OLD.status, 'result', OLD.result, 'reasonCode', OLD.error_code, 'createdAt', OLD.created_at); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='activation.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('activation',resource_id,r,NEW.name_id,NEW.partner_id,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON integration_operations
 FOR EACH ROW EXECUTE FUNCTION integration_capture_integration_operations();

ALTER TABLE integration_transfers ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON integration_transfers FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_integration_transfers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'transfer.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.id::text; r := NEW.integration_revision;
 p := jsonb_build_object('nameId', NEW.name_id, 'reference', NEW.reference, 'chainId', NEW.chain_id::text, 'transferKind', NEW.transfer_kind, 'attempts', NEW.attempts, 'verification', NEW.verification, 'depositId', NEW.deposit_id, 'status', NEW.status, 'reasonCode', NEW.error_code, 'createdAt', NEW.created_at);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('nameId', OLD.name_id, 'reference', OLD.reference, 'chainId', OLD.chain_id::text, 'transferKind', OLD.transfer_kind, 'attempts', OLD.attempts, 'verification', OLD.verification, 'depositId', OLD.deposit_id, 'status', OLD.status, 'reasonCode', OLD.error_code, 'createdAt', OLD.created_at); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='transfer.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('transfer',resource_id,r,NEW.name_id,NEW.partner_id,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON integration_transfers
 FOR EACH ROW EXECUTE FUNCTION integration_capture_integration_transfers();

ALTER TABLE integration_consumptions ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON integration_consumptions FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_integration_consumptions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'consumption.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.id; r := NEW.integration_revision;
 p := jsonb_build_object('status', NEW.status, 'linkage', NEW.linkage, 'flowIds', NEW.flow_ids, 'reasonCode', NEW.reason);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('status', OLD.status, 'linkage', OLD.linkage, 'flowIds', OLD.flow_ids, 'reasonCode', OLD.reason); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='consumption.deleted'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('consumption',resource_id,r,NEW.name_id,NULL,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON integration_consumptions
 FOR EACH ROW EXECUTE FUNCTION integration_capture_integration_consumptions();

ALTER TABLE integration_settlements ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON integration_settlements FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_integration_settlements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; old_p jsonb; r bigint; resource_id text; et text := 'settlement.updated';
BEGIN
 IF TG_OP='DELETE' THEN NEW:=OLD; END IF;
 resource_id := NEW.id; r := NEW.integration_revision;
 p := jsonb_build_object('flowId', NEW.flow_id, 'nameId', NEW.name_id, 'status', NEW.status, 'evidence', NEW.evidence, 'amounts', NEW.amounts, 'durationSeconds', NEW.duration_seconds::text, 'expiryAfter', NEW.expiry_after, 'observedAt', NEW.observed_at, 'finalizedAt', NEW.finalized_at);
 IF TG_OP='UPDATE' THEN old_p := jsonb_build_object('flowId', OLD.flow_id, 'nameId', OLD.name_id, 'status', OLD.status, 'evidence', OLD.evidence, 'amounts', OLD.amounts, 'durationSeconds', OLD.duration_seconds::text, 'expiryAfter', OLD.expiry_after, 'observedAt', OLD.observed_at, 'finalizedAt', OLD.finalized_at); IF p=old_p THEN RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN p:=p || '{"deleted":true}'::jsonb; r:=r+1; et:='settlement.deleted'; END IF;
 IF TG_OP='DELETE' THEN et:='settlement.deleted'; ELSIF NEW.status='observed' THEN et:='settlement.observed'; ELSIF NEW.status='finalized' THEN et:='settlement.finalized'; ELSE et:='settlement.invalidated'; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type)
 VALUES('settlement',resource_id,r,NEW.name_id,NULL,p || jsonb_build_object('id',resource_id,'version',r::text),et);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON integration_settlements
 FOR EACH ROW EXECUTE FUNCTION integration_capture_integration_settlements();

INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type) SELECT 'name', t.id::text, 0, t.id, NULL, jsonb_build_object('id',t.id::text,'version','0','label', t.normalized_label, 'name', t.display_name, 'depositAddress', t.deposit_address, 'activatedAt', t.activated_at, 'currentExpiry', t.current_expiry, 'renewableBy', t.renewable_by, 'ensSyncedAt', t.ens_synced_at, 'unscannedChainIds', ARRAY(SELECT x::text FROM unnest(t.unscanned_chain_ids) x), 'lifetimeReceived', t.lifetime_received::text, 'lifetimeApplied', t.lifetime_applied::text, 'timeDeliveredSeconds', t.time_delivered_seconds::text, 'renewalCount', t.renewal_count::text), 'name.snapshot' FROM names t;

INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type) SELECT 'deposit', t.event_id, 0, t.name_id, NULL, jsonb_build_object('id',t.event_id,'version','0','nameId', t.name_id, 'chainId', t.chain_id::text, 'tokenAddress', t.token_address, 'senderAddress', t.sender_address, 'amount', t.amount::text, 'txHash', t.tx_hash, 'transferKind', t.transfer_kind, 'logIndex', CASE WHEN t.transfer_kind='native' THEN NULL ELSE t.log_index END, 'blockNumber', t.block_number::text, 'blockTime', t.block_time, 'observationStatus', t.status), 'deposit.snapshot' FROM deposits t;

INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type) SELECT 'flow', t.id::text, 0, t.name_id, NULL, jsonb_build_object('id',t.id::text,'version','0','nameId', t.name_id, 'originChainId', t.origin_chain_id::text, 'executionStatus', t.status, 'status', CASE WHEN t.status='settled' AND NOT EXISTS(SELECT 1 FROM integration_settlements verified WHERE verified.flow_id=t.id AND verified.status IN ('observed','finalized')) THEN 'verifying_settlement' ELSE t.status::text END, 'trigger', t.trigger, 'holdReason', t.hold_reason, 'amountDetected', t.amount_detected::text, 'amountProcessed', t.amount_processed::text, 'originWalletRemainder', t.remaining_amount::text, 'executorAllowance', t.gas_allowance::text, 'amountApplied', t.amount_applied::text, 'durationSeconds', t.duration_seconds::text, 'expiryAfter', t.expiry_after, 'depositId', t.deposit_event_id, 'originEventId', t.origin_event_id, 'renewalEventId', t.renewal_event_id, 'originTxHash', t.origin_evidence_tx_hash, 'cctpNonce', t.cctp_nonce::text, 'reasonCode', t.last_error_code, 'nextActionAt', t.next_action_at, 'createdAt', t.created_at, 'settledAt', t.settled_at), 'flow.snapshot' FROM flows t;

INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,partner_id,payload,event_type) SELECT 'balance', t.name_id::text || ':' || t.chain_id::text, 0, t.name_id, NULL, jsonb_build_object('id',t.name_id::text || ':' || t.chain_id::text,'version','0','nameId', t.name_id, 'chainId', t.chain_id::text, 'snapshotAmount', t.amount::text, 'snapshotBlock', t.block_number::text), 'balance.snapshot' FROM balance_snapshots t;

CREATE FUNCTION integration_schedule_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; n uuid; c numeric; j jsonb;
BEGIN
 IF TG_TABLE_NAME='flows' THEN
  IF NEW.status='settled' OR NEW.origin_evidence_tx_hash IS NOT NULL THEN
   k:='flow:'||NEW.id; j:=jsonb_build_object('flowId',NEW.id);
   INSERT INTO integration_jobs(key,kind,input) VALUES(k,'flow_evidence',j)
   ON CONFLICT(key) DO UPDATE SET status=CASE WHEN integration_jobs.status='running' THEN 'running' ELSE 'pending' END,
    next_at=now(), updated_at=now();
  END IF;
 ELSIF TG_TABLE_NAME='deposits' THEN
  k:='deposit:'||NEW.event_id; j:=jsonb_build_object('depositId',NEW.event_id);
  INSERT INTO integration_jobs(key,kind,input) VALUES(k,'deposit_evidence',j)
  ON CONFLICT(key) DO UPDATE SET status=CASE WHEN integration_jobs.status='running' THEN 'running' ELSE 'pending' END,
   next_at=now(), updated_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER integration_evidence AFTER INSERT OR UPDATE OF status,origin_evidence_tx_hash,renewal_event_id ON flows
 FOR EACH ROW EXECUTE FUNCTION integration_schedule_evidence();
CREATE TRIGGER integration_evidence AFTER INSERT OR UPDATE OF status ON deposits
 FOR EACH ROW EXECUTE FUNCTION integration_schedule_evidence();

-- Transaction evidence is public; signed bytes and replacement fee payloads are not.
ALTER TABLE transaction_intents ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; previous jsonb; n uuid;
BEGIN
 p:=jsonb_build_object('id',NEW.id::text,'flowId',NEW.flow_id,'chainId',NEW.chain_id::text,
 'kind',NEW.kind,'status',NEW.status,'txHash',COALESCE(NEW.receipt->>'transactionHash',NEW.current_tx_hash));
 IF TG_OP='UPDATE' THEN
 previous:=jsonb_build_object('id',OLD.id::text,'flowId',OLD.flow_id,'chainId',OLD.chain_id::text,
 'kind',OLD.kind,'status',OLD.status,'txHash',COALESCE(OLD.receipt->>'transactionHash',OLD.current_tx_hash));
 IF p=previous THEN RETURN NEW; END IF;
 END IF;
 SELECT name_id INTO n FROM flows WHERE id=NEW.flow_id;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type)
 VALUES('transaction',NEW.id::text,NEW.integration_revision,n,p||jsonb_build_object('version',NEW.integration_revision::text),'transaction.updated');
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION integration_capture_transaction();
CREATE FUNCTION integration_capture_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; n uuid;
BEGIN
 target:=COALESCE(NEW.detail->>'canonicalFlowId',NEW.detail->>'consumingFlowId');
 IF target IS NULL THEN RETURN NEW; END IF;
 INSERT INTO integration_identity_aliases(alias,canonical_id,kind) VALUES(NEW.flow_id::text,target,'flow')
 ON CONFLICT(alias) DO UPDATE SET canonical_id=excluded.canonical_id;
 SELECT name_id INTO n FROM flows WHERE id=NEW.flow_id;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type)
 VALUES('supersession',NEW.id::text,1,n,jsonb_build_object('id',NEW.id::text,'version','1','flowId',NEW.flow_id,'supersededBy',target),'flow.superseded');
 RETURN NEW;
END $$;
CREATE TRIGGER integration_supersession AFTER INSERT ON flow_transitions FOR EACH ROW EXECUTE FUNCTION integration_capture_supersession();
-- Reorgs need work even if the affected flow no longer has an event pointer.
CREATE FUNCTION integration_canonicality_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.canonical,OLD.facts,OLD.block_number) IS NOT DISTINCT FROM (NEW.canonical,NEW.facts,NEW.block_number) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
 UPDATE integration_evidence SET canonical=false WHERE id=NEW.event_id AND canonical;
 END IF;
 FOR f IN SELECT id FROM flows WHERE renewal_event_id=NEW.event_id OR origin_event_id=NEW.event_id
 LOOP
 INSERT INTO integration_jobs(key,kind,input) VALUES('flow:'||f.id,'flow_evidence',jsonb_build_object('flowId',f.id))
 ON CONFLICT(key) DO UPDATE SET status=CASE WHEN integration_jobs.status='running' THEN 'running' ELSE 'pending' END,next_at=now(),updated_at=now();
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER integration_canonicality AFTER INSERT OR UPDATE ON chain_events FOR EACH ROW EXECUTE FUNCTION integration_canonicality_work();
-- Backfill verification is bounded by the worker; missing evidence remains explicit.
INSERT INTO integration_jobs(key,kind,input)
 SELECT 'deposit:'||event_id,'deposit_evidence',jsonb_build_object('depositId',event_id) FROM deposits;
INSERT INTO integration_jobs(key,kind,input)
 SELECT 'flow:'||id,'flow_evidence',jsonb_build_object('flowId',id) FROM flows WHERE status='settled' OR origin_evidence_tx_hash IS NOT NULL;
-- Evidence and coverage changes are replayable independently of execution state.
ALTER TABLE integration_evidence ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON integration_evidence FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n uuid; p jsonb; prev jsonb;
BEGIN
 SELECT name_id INTO n FROM deposits WHERE event_id=NEW.id;
 IF n IS NULL THEN SELECT name_id INTO n FROM flows WHERE origin_event_id=NEW.id OR renewal_event_id=NEW.id LIMIT 1; END IF;
 IF n IS NULL THEN RETURN NEW; END IF;
 p:=jsonb_build_object('chainId',NEW.chain_id::text,'txHash',NEW.tx_hash,'blockNumber',NEW.block_number::text,'blockHash',NEW.block_hash,
 'transactionIndex',NEW.transaction_index,'logIndex',NEW.log_index,'transferKind',NEW.transfer_kind,'canonical',NEW.canonical);
 IF TG_OP='UPDATE' THEN
 prev:=jsonb_build_object('chainId',OLD.chain_id::text,'txHash',OLD.tx_hash,'blockNumber',OLD.block_number::text,'blockHash',OLD.block_hash,
 'transactionIndex',OLD.transaction_index,'logIndex',OLD.log_index,'transferKind',OLD.transfer_kind,'canonical',OLD.canonical);
 IF p=prev THEN RETURN NEW; END IF; END IF;
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type)
 VALUES('evidence',NEW.id,NEW.integration_revision,n,p||jsonb_build_object('id',NEW.id,'version',NEW.integration_revision::text),'evidence.updated');
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE ON integration_evidence FOR EACH ROW EXECUTE FUNCTION integration_capture_evidence();
ALTER TABLE integration_coverage ADD COLUMN integration_revision bigint NOT NULL DEFAULT 0;
CREATE TRIGGER integration_revision BEFORE INSERT OR UPDATE ON integration_coverage FOR EACH ROW EXECUTE FUNCTION integration_revision();
CREATE FUNCTION integration_capture_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid text; p jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.from_block,NEW.through_block,NEW.through_hash,NEW.native_from,NEW.native_through,NEW.native_target,NEW.status) IS NOT DISTINCT FROM (OLD.from_block,OLD.through_block,OLD.through_hash,OLD.native_from,OLD.native_through,OLD.native_target,OLD.status) THEN RETURN NEW; END IF;
 rid:=NEW.name_id::text||':'||NEW.chain_id::text;
 p:=jsonb_build_object('id',rid,'version',NEW.integration_revision::text,'nameId',NEW.name_id,'chainId',NEW.chain_id::text,
 'fromBlock',NEW.from_block::text,'throughBlock',NEW.through_block::text,'throughBlockHash',NEW.through_hash,'nativeFromBlock',NEW.native_from::text,'nativeThroughBlock',NEW.native_through::text,'nativeTargetBlock',NEW.native_target::text,'status',NEW.status,'checkedAt',NEW.updated_at);
 INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type)
 VALUES('coverage',rid,NEW.integration_revision,NEW.name_id,p,'coverage.updated');
 RETURN NEW;
END $$;
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE ON integration_coverage FOR EACH ROW EXECUTE FUNCTION integration_capture_coverage();
INSERT INTO integration_outbox(resource_kind,resource_id,revision,name_id,payload,event_type)
 SELECT 'transaction',t.id::text,0,f.name_id,jsonb_build_object('id',t.id::text,'version','0','flowId',t.flow_id,'chainId',t.chain_id::text,
 'kind',t.kind,'status',t.status,'txHash',COALESCE(t.receipt->>'transactionHash',t.current_tx_hash)),'transaction.snapshot' FROM transaction_intents t JOIN flows f ON f.id=t.flow_id;

CREATE UNIQUE INDEX integration_settlements_active_flow_unique ON integration_settlements(flow_id) WHERE status<>'invalidated';
CREATE FUNCTION integration_settlement_flow_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.status,OLD.evidence,OLD.amounts) IS NOT DISTINCT FROM (NEW.status,NEW.evidence,NEW.amounts) THEN RETURN NEW; END IF;
 -- Re-emit the flow's public verification state in this same settlement transaction.
 UPDATE flows SET updated_at=now() WHERE id=NEW.flow_id;
 RETURN NEW;
END $$;
CREATE TRIGGER integration_settlement_flow AFTER INSERT OR UPDATE ON integration_settlements FOR EACH ROW EXECUTE FUNCTION integration_settlement_flow_snapshot();
-- A durable receipt cursor bounds dense history scans to one transaction per job.
CREATE TABLE integration_coverage_batches (
 name_id uuid NOT NULL REFERENCES names(id), chain_id numeric(78,0) NOT NULL,
 anchor_from numeric(78,0) NOT NULL, anchor_through numeric(78,0),
 from_block numeric(78,0) NOT NULL, to_block numeric(78,0) NOT NULL, to_hash text NOT NULL,
 hashes text[] NOT NULL, next_index integer NOT NULL DEFAULT 0,
 PRIMARY KEY(name_id,chain_id)
);

-- Revoke dependent completion in the source transaction, before asynchronous
-- repair. The journal therefore never leaves a known reorg marked complete.
CREATE FUNCTION integration_revoke_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT OLD.canonical OR (NEW.canonical AND OLD.block_hash=NEW.block_hash) THEN RETURN NEW; END IF;
 UPDATE integration_settlements SET status='invalidated',finalized_at=null,updated_at=now()
 WHERE status<>'invalidated' AND flow_id IN(SELECT id FROM flows WHERE origin_event_id=NEW.id OR renewal_event_id=NEW.id);
 UPDATE integration_consumptions SET status='unresolved',reason='evidence_changed',updated_at=now()
 WHERE id=NEW.id OR flow_ids && ARRAY(SELECT id FROM flows WHERE origin_event_id=NEW.id OR renewal_event_id=NEW.id);
 UPDATE integration_transfers SET status=CASE WHEN deposit_id=NEW.id AND NOT NEW.canonical THEN 'orphaned' ELSE 'verified' END,updated_at=now()
 WHERE status IN('verified','completed') AND (deposit_id=NEW.id OR deposit_id IN(
 SELECT id FROM integration_consumptions WHERE flow_ids && ARRAY(SELECT id FROM flows WHERE origin_event_id=NEW.id OR renewal_event_id=NEW.id)));
 RETURN NEW;
END $$;
CREATE TRIGGER integration_revoke AFTER UPDATE ON integration_evidence FOR EACH ROW EXECUTE FUNCTION integration_revoke_evidence();

CREATE FUNCTION integration_revoke_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='finalized' AND NEW.status<>'finalized' THEN
 UPDATE integration_consumptions SET status='unresolved',reason='settlement_changed',updated_at=now() WHERE NEW.flow_id=ANY(flow_ids);
 UPDATE integration_transfers SET status='verified',updated_at=now() WHERE status='completed'
 AND deposit_id IN(SELECT id FROM integration_consumptions WHERE NEW.flow_id=ANY(flow_ids));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER integration_revoke AFTER UPDATE ON integration_settlements FOR EACH ROW EXECUTE FUNCTION integration_revoke_settlement();
