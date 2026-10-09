CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS shopping_domain;

CREATE TABLE IF NOT EXISTS shopping_domain.lists (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shopping_domain.items (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES shopping_domain.lists(id) ON DELETE CASCADE,
  product_id uuid NULL,
  label varchar(300) NOT NULL CHECK (length(trim(label)) > 0),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(16) NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  source varchar(32) NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shopping_domain.outbox_events (
  event_id uuid PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS shopping_domain.idempotency_keys (
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

CREATE INDEX IF NOT EXISTS shopping_lists_family_status_idx
  ON shopping_domain.lists(family_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS shopping_items_list_idx
  ON shopping_domain.items(list_id,created_at);
CREATE INDEX IF NOT EXISTS shopping_outbox_publish_idx
  ON shopping_domain.outbox_events(published_at,created_at);
