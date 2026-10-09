CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS nutrition_domain;

CREATE TABLE IF NOT EXISTS nutrition_domain.targets (
  user_id uuid PRIMARY KEY,
  calories_kcal numeric(10,2) NOT NULL CHECK(calories_kcal>=0),
  protein_g numeric(10,2) NOT NULL CHECK(protein_g>=0),
  carbs_g numeric(10,2) NOT NULL CHECK(carbs_g>=0),
  fat_g numeric(10,2) NOT NULL CHECK(fat_g>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS nutrition_domain.diary_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  date date NOT NULL,
  meal varchar(32) NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK(quantity>0),
  unit varchar(16) NOT NULL,
  source varchar(32) NOT NULL CHECK(source IN ('manual','inventory')),
  source_movement_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS nutrition_domain.idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('processing','completed','failed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS nutrition_domain.outbox_events (
  event_id uuid PRIMARY KEY,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  aggregate_id uuid NOT NULL,
  family_id uuid NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS nutrition_diary_user_date_idx
  ON nutrition_domain.diary_entries(user_id,date DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS nutrition_outbox_publish_idx
  ON nutrition_domain.outbox_events(published_at,created_at);
