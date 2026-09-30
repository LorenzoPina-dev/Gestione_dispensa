CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(128) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  normalized_name varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(32) NOT NULL,
  name varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, name)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name varchar(300) NOT NULL,
  brand_id uuid NULL REFERENCES brands(id),
  default_unit varchar(16) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  provenance_quality varchar(32) NOT NULL DEFAULT 'UNKNOWN',
  version integer NOT NULL DEFAULT 1,
  category varchar(120) NULL,
  photo_url varchar(1000) NULL,
  calories_per_100 numeric(12,3) NULL,
  protein_per_100 numeric(12,3) NULL,
  carbs_per_100 numeric(12,3) NULL,
  fat_per_100 numeric(12,3) NULL,
  fiber_per_100 numeric(12,3) NULL,
  nutrition_confidence varchar(32) NULL,
  external_source varchar(128) NULL,
  external_ref varchar(255) NULL,
  external_synced_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_unit_check CHECK (default_unit IN ('g','kg','ml','l','piece','pack')),
  CONSTRAINT products_status_check CHECK (status IN ('ACTIVE')),
  CONSTRAINT products_quality_check CHECK (provenance_quality IN ('VERIFIED','IMPORTED','ESTIMATED','UNKNOWN'))
);

CREATE TABLE IF NOT EXISTS product_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES data_sources(id),
  identifier_type varchar(32) NOT NULL,
  normalized_value varchar(100) NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, identifier_type, normalized_value)
);

CREATE TABLE IF NOT EXISTS data_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type varchar(64) NOT NULL,
  entity_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES data_sources(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  source_version varchar(128) NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  raw_ref varchar(500) NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  event_type varchar(128) NOT NULL,
  event_version integer NOT NULL,
  aggregate_type varchar(64) NOT NULL,
  aggregate_id uuid NOT NULL,
  actor_id uuid NULL,
  trace_id varchar(128) NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  published_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key varchar(255) PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  status varchar(32) NOT NULL,
  response_status integer NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_identifiers_barcode ON product_identifiers(identifier_type, normalized_value);
CREATE INDEX IF NOT EXISTS idx_product_sources_external ON products(external_source, external_ref);
CREATE INDEX IF NOT EXISTS idx_provenance_entity ON data_provenance(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_catalog_outbox_unpublished ON outbox_events(published_at, created_at);
CREATE INDEX IF NOT EXISTS idx_catalog_products_name ON products(canonical_name);

INSERT INTO schema_migrations(version) VALUES ('001_initial') ON CONFLICT DO NOTHING;
