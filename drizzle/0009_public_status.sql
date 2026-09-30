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
-- Public transaction status verification. No accounts, keys or event journal.
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

-- Reorgs need work even if the affected flow no longer has an event pointer.
CREATE FUNCTION integration_canonicality_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.canonical,OLD.facts,OLD.block_number,OLD.chain_id,OLD.tx_hash,OLD.log_index,OLD.evidence_kind,OLD.event_type) IS NOT DISTINCT FROM (NEW.canonical,NEW.facts,NEW.block_number,NEW.chain_id,NEW.tx_hash,NEW.log_index,NEW.evidence_kind,NEW.event_type) THEN RETURN NEW; END IF;
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
CREATE UNIQUE INDEX integration_settlements_active_flow_unique ON integration_settlements(flow_id) WHERE status<>'invalidated';
CREATE TABLE integration_coverage_batches (
 name_id uuid NOT NULL REFERENCES names(id), chain_id numeric(78,0) NOT NULL,
 anchor_from numeric(78,0) NOT NULL, anchor_through numeric(78,0),
 from_block numeric(78,0) NOT NULL, to_block numeric(78,0) NOT NULL, to_hash text NOT NULL,
 hashes text[] NOT NULL, next_index integer NOT NULL DEFAULT 0,
 PRIMARY KEY(name_id,chain_id)
);

CREATE FUNCTION integration_revoke_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT OLD.canonical OR (NEW.canonical AND OLD.block_hash=NEW.block_hash) THEN RETURN NEW; END IF;
 UPDATE integration_settlements SET status='invalidated',finalized_at=null,updated_at=now()
 WHERE status<>'invalidated' AND flow_id IN(SELECT id FROM flows WHERE origin_event_id=NEW.id OR renewal_event_id=NEW.id);
 UPDATE integration_consumptions SET status='unresolved',reason='evidence_changed',updated_at=now()
 WHERE id=NEW.id OR flow_ids && ARRAY(SELECT id FROM flows WHERE origin_event_id=NEW.id OR renewal_event_id=NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER integration_revoke AFTER UPDATE ON integration_evidence FOR EACH ROW EXECUTE FUNCTION integration_revoke_evidence();

CREATE FUNCTION integration_revoke_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='finalized' AND NEW.status<>'finalized' THEN
 UPDATE integration_consumptions SET status='unresolved',reason='settlement_changed',updated_at=now() WHERE NEW.flow_id=ANY(flow_ids);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER integration_revoke AFTER UPDATE ON integration_settlements FOR EACH ROW EXECUTE FUNCTION integration_revoke_settlement();

CREATE INDEX deposits_chain_tx_idx ON deposits(chain_id,tx_hash);
