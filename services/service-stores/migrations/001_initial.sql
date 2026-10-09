CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS stores_domain;

CREATE TABLE IF NOT EXISTS stores_domain.stores (
  id uuid PRIMARY KEY,
  name varchar(300) NOT NULL CHECK(length(trim(name))>0),
  chain varchar(200),
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stores_domain.prices (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores_domain.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>=0),
  currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  observed_at timestamptz NOT NULL,
  source varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores_domain.offers (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores_domain.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  type varchar(32) NOT NULL CHECK(type IN ('percentage','fixed')),
  value numeric(12,4) NOT NULL CHECK(value>=0),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK(valid_from < valid_to),
  CHECK(type <> 'percentage' OR value <= 100)
);

CREATE TABLE IF NOT EXISTS stores_domain.idempotency_keys (
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

CREATE TABLE IF NOT EXISTS stores_domain.outbox_events (
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

CREATE INDEX IF NOT EXISTS stores_price_product_observed_idx
  ON stores_domain.prices(store_id,product_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS stores_offer_validity_idx
  ON stores_domain.offers(store_id,valid_from,valid_to);
CREATE INDEX IF NOT EXISTS stores_outbox_publish_idx
  ON stores_domain.outbox_events(published_at,created_at);
