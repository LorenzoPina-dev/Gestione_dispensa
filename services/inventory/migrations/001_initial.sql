CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pantry_lots (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  product_id uuid NOT NULL,
  lot_code varchar(100),
  received_at timestamptz NOT NULL,
  best_before_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pantry_items (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  product_id uuid NOT NULL,
  lot_id uuid NULL REFERENCES pantry_lots(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(16) NOT NULL,
  location varchar(32),
  opened_at timestamptz,
  expires_at timestamptz,
  expiration_source varchar(16) CHECK (expiration_source IN ('declared','estimated')),
  lot_code varchar(100),
  added_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS pantry_items_family_product_idx ON pantry_items(family_id, product_id);
CREATE INDEX IF NOT EXISTS pantry_items_family_expiry_idx ON pantry_items(family_id, expires_at);
CREATE INDEX IF NOT EXISTS pantry_items_family_lot_idx ON pantry_items(family_id, lot_id);

CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  pantry_item_id uuid NULL,
  product_id uuid NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('add','consume','waste','adjust','remove')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(16) NOT NULL,
  reason varchar(64),
  actor_user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_family_time_idx ON movements(family_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS movements_item_time_idx ON movements(pantry_item_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  event_id uuid UNIQUE NOT NULL,
  event_type varchar(128) NOT NULL,
  schema_version integer NOT NULL,
  aggregate_id uuid NOT NULL,
  family_id uuid,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_publish_idx ON outbox_events(published_at, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  family_id uuid,
  request_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('processing','completed','failed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
