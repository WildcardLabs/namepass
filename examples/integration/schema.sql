-- Run only in your application's database, not Namepass's database.
CREATE TABLE IF NOT EXISTS namepass_inbox (
 event_id text PRIMARY KEY, envelope jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS namepass_resources (
 deployment_id text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL,
 version numeric(78,0) NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(deployment_id,resource_type,resource_id)
);
CREATE TABLE IF NOT EXISTS namepass_checkpoint (
 integration text PRIMARY KEY, cursor text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
