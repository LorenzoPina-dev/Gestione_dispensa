CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS shelf_life_domain;

CREATE TABLE IF NOT EXISTS shelf_life_domain.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_category varchar(120) NULL,
  storage varchar(32) NOT NULL CHECK(storage IN ('PANTRY','FRIDGE','FREEZER','CELLAR','OTHER')),
  opened boolean NOT NULL,
  min_days integer NOT NULL CHECK(min_days >= 0),
  max_days integer NOT NULL CHECK(max_days >= min_days),
  model_version varchar(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The table may already exist from an older 001 migration that did not have
-- product_category. CREATE TABLE IF NOT EXISTS does not alter an existing table.
ALTER TABLE shelf_life_domain.rules
  ADD COLUMN IF NOT EXISTS product_category varchar(120) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shelf_rules_unique
  ON shelf_life_domain.rules(coalesce(product_category,''),storage,opened,model_version);

CREATE TABLE IF NOT EXISTS shelf_life_domain.predictions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  family_id uuid NULL,
  item_id uuid NOT NULL,
  product_id uuid NOT NULL,
  estimated_expires_at timestamptz NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  basis varchar(200) NOT NULL,
  model_version varchar(64) NOT NULL,
  status varchar(32) NOT NULL CHECK(status IN ('queued','completed','applied','superseded','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shelf_life_domain.idempotency_keys (
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

CREATE TABLE IF NOT EXISTS shelf_life_domain.outbox_events (
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
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS shelf_predictions_item_status_idx
  ON shelf_life_domain.predictions(item_id,status);

CREATE INDEX IF NOT EXISTS shelf_predictions_product_created_idx
  ON shelf_life_domain.predictions(product_id,created_at DESC);

CREATE INDEX IF NOT EXISTS shelf_outbox_publish_idx
  ON shelf_life_domain.outbox_events(published_at,created_at);

-- Baseline heuristics: these are estimates only, never a food-safety guarantee.
-- A generic rule exists for every supported storage/opened state so a missing
-- product-specific rule does not leave a prediction permanently unavailable.
INSERT INTO shelf_life_domain.rules
  (product_category, storage, opened, min_days, max_days, model_version, active)
VALUES
  (NULL, 'PANTRY', false, 30, 90, 'baseline-v1', true),
  (NULL, 'PANTRY', true, 7, 21, 'baseline-v1', true),
  (NULL, 'FRIDGE', false, 7, 21, 'baseline-v1', true),
  (NULL, 'FRIDGE', true, 2, 7, 'baseline-v1', true),
  (NULL, 'FREEZER', false, 90, 180, 'baseline-v1', true),
  (NULL, 'FREEZER', true, 30, 90, 'baseline-v1', true),
  (NULL, 'CELLAR', false, 14, 60, 'baseline-v1', true),
  (NULL, 'CELLAR', true, 7, 21, 'baseline-v1', true),
  (NULL, 'OTHER', false, 14, 60, 'baseline-v1', true),
  (NULL, 'OTHER', true, 7, 21, 'baseline-v1', true)
ON CONFLICT DO NOTHING;

