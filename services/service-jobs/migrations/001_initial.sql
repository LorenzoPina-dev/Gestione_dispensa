CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  family_id uuid NULL,
  capability varchar(100) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED','DEGRADED')),
  idempotency_key varchar(255) NOT NULL,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  current_attempt integer NOT NULL DEFAULT 0 CHECK (current_attempt >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  result_ref jsonb NULL,
  last_error_code varchar(128) NULL,
  last_error_class varchar(16) NULL CHECK (last_error_class IN ('TRANSIENT','PERMANENT')),
  trace_id varchar(128) NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(capability,idempotency_key)
);

CREATE TABLE IF NOT EXISTS job_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  status varchar(16) NOT NULL,
  error_code varchar(128) NULL,
  error_class varchar(16) NULL,
  duration_ms integer NULL,
  UNIQUE(job_id,attempt)
);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  queue varchar(128) NOT NULL,
  reason text NOT NULL,
  error_code varchar(128) NULL,
  error_class varchar(16) NULL,
  attempts integer NOT NULL,
  replay_count integer NOT NULL DEFAULT 0,
  failed_at timestamptz NOT NULL,
  original_created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NULL,
  action varchar(128) NOT NULL,
  resource_type varchar(128) NOT NULL,
  resource_id uuid NULL,
  outcome varchar(32) NOT NULL,
  reason text NULL,
  trace_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name varchar(128) NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NULL,
  outcome varchar(32) NULL,
  UNIQUE(consumer_name,event_id)
);

CREATE INDEX IF NOT EXISTS jobs_status_next_attempt_idx ON jobs(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS jobs_family_idx ON jobs(family_id,created_at DESC);
CREATE INDEX IF NOT EXISTS dead_letter_failed_idx ON dead_letter_jobs(failed_at DESC);
