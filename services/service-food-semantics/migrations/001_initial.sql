CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS food_semantics;

CREATE TABLE IF NOT EXISTS food_semantics.ontology_sources (
  id uuid PRIMARY KEY,
  source_key varchar(120) NOT NULL UNIQUE,
  version varchar(120) NOT NULL,
  source_url text NOT NULL,
  license text NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  checksum varchar(128) NULL,
  entity_count bigint NOT NULL DEFAULT 0,
  label_count bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS food_semantics.entities (
  id uuid PRIMARY KEY,
  source_key varchar(120) NOT NULL,
  source_id varchar(255) NOT NULL,
  parent_source_id varchar(255) NULL,
  entity_type varchar(64) NOT NULL DEFAULT 'FOOD',
  definition text NULL,
  UNIQUE(source_key, source_id)
);

CREATE TABLE IF NOT EXISTS food_semantics.labels (
  entity_id uuid NOT NULL REFERENCES food_semantics.entities(id) ON DELETE CASCADE,
  locale varchar(32) NOT NULL,
  label text NOT NULL,
  normalized text NOT NULL,
  label_type varchar(32) NOT NULL DEFAULT 'label',
  PRIMARY KEY(entity_id, locale, normalized, label_type)
);

CREATE INDEX IF NOT EXISTS food_semantics_labels_normalized_idx
  ON food_semantics.labels USING gin (normalized gin_trgm_ops);

CREATE TABLE IF NOT EXISTS food_semantics.relations (
  source_entity_id uuid NOT NULL REFERENCES food_semantics.entities(id) ON DELETE CASCADE,
  relation varchar(64) NOT NULL,
  target_source_key varchar(120) NOT NULL,
  target_source_id varchar(255) NOT NULL,
  PRIMARY KEY(source_entity_id, relation, target_source_key, target_source_id)
);

CREATE TABLE IF NOT EXISTS food_semantics.product_mappings (
  product_id uuid PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES food_semantics.entities(id),
  source varchar(64) NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_semantics.resolution_cache (
  input_text text NOT NULL,
  input_normalized text NOT NULL,
  source_locale varchar(32) NOT NULL,
  target_locale varchar(32) NOT NULL,
  entity_id uuid NULL REFERENCES food_semantics.entities(id),
  translated_text text NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL,
  provider varchar(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(input_normalized, source_locale, target_locale)
);

CREATE INDEX IF NOT EXISTS food_semantics_cache_lookup_idx
  ON food_semantics.resolution_cache(input_normalized, source_locale, target_locale);
