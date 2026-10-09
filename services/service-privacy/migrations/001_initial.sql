CREATE TABLE IF NOT EXISTS privacy_consents (
  user_id uuid NOT NULL,
  purpose varchar(100) NOT NULL,
  granted boolean NOT NULL,
  consent_version varchar(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,purpose)
);

CREATE TABLE IF NOT EXISTS privacy_erasure_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  requester_id uuid NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'REQUESTED'
    CHECK(status IN ('REQUESTED','PROCESSING','COMPLETED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (family_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS privacy_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','COMPLETED','FAILED','EXPIRED')),
  artifact_id uuid NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS export_artifacts (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  content jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NULL,
  actor_id uuid NULL,
  action varchar(128) NOT NULL,
  resource_type varchar(128) NOT NULL,
  resource_id uuid NULL,
  outcome varchar(32) NOT NULL,
  reason text NULL,
  trace_id varchar(128) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL
    CHECK(status IN ('processing','completed','failed')),
  response_status integer NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid UNIQUE NOT NULL,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  aggregate_id uuid NOT NULL,
  family_id uuid NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_export_jobs_owner_idx
  ON privacy_export_jobs(owner_id,created_at DESC);

CREATE INDEX IF NOT EXISTS privacy_erasure_requests_family_idx
  ON privacy_erasure_requests(family_id,created_at DESC);

CREATE INDEX IF NOT EXISTS privacy_outbox_publish_idx
  ON outbox_events(published_at,created_at);
