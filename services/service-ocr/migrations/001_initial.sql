CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS ocr_domain;

CREATE TABLE IF NOT EXISTS ocr_domain.ocr_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  family_id uuid NULL,
  type varchar(32) NOT NULL CHECK(type IN ('receipt','pantry_image')),
  object_key varchar(500) NOT NULL,
  status varchar(32) NOT NULL CHECK(status IN ('queued','processing','completed','failed','cancelled','needs_review')),
  progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  error_code varchar(100) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ocr_domain.ocr_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ocr_domain.ocr_jobs(id) ON DELETE CASCADE,
  confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  status varchar(32) NOT NULL CHECK(status IN ('draft','confirmed','rejected')),
  raw_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ocr_domain.ocr_draft_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES ocr_domain.ocr_drafts(id) ON DELETE CASCADE,
  name varchar(300) NOT NULL,
  barcode varchar(64) NULL,
  quantity numeric(14,3) NULL,
  unit varchar(16) NULL,
  price_minor bigint NULL,
  currency char(3) NULL,
  confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  product_id uuid NULL
);

CREATE TABLE IF NOT EXISTS ocr_domain.idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('processing','completed','failed')),
  response_status integer NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ocr_domain.outbox_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  aggregate_id uuid NOT NULL,
  family_id uuid NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ocr_jobs_status_created_idx ON ocr_domain.ocr_jobs(status,created_at DESC);
CREATE INDEX IF NOT EXISTS ocr_drafts_job_idx ON ocr_domain.ocr_drafts(job_id);
CREATE INDEX IF NOT EXISTS ocr_outbox_publish_idx ON ocr_domain.outbox_events(published_at,created_at);
