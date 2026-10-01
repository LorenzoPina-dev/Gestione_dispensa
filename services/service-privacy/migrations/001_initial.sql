CREATE TABLE IF NOT EXISTS consents (
  user_id uuid PRIMARY KEY,
  analytics boolean NOT NULL DEFAULT false,
  personalization boolean NOT NULL DEFAULT false,
  notifications boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS privacy_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('export','erase')),
  status varchar(16) NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  object_key varchar(500) NULL,
  error_code varchar(128) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS erasure_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  status varchar(32) NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','COMPLETED','FAILED')),
  completed_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('processing','completed','failed')),
  response_status integer NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
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
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS privacy_jobs_user_created_idx ON privacy_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS privacy_jobs_status_idx ON privacy_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS privacy_outbox_publish_idx ON outbox_events(published_at, created_at);
