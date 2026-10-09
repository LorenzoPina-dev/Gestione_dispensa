CREATE SCHEMA IF NOT EXISTS food_semantics;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS food_semantics.ontology_sources (
  id uuid PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  version text NOT NULL,
  source_url text NOT NULL,
  license text,
  checksum text NOT NULL,
  entity_count integer NOT NULL DEFAULT 0,
  label_count integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_semantics.entities (
  id uuid PRIMARY KEY,
  source_key text NOT NULL,
  source_id text NOT NULL,
  parent_source_id text,
  entity_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_key, source_id)
);

CREATE TABLE IF NOT EXISTS food_semantics.labels (
  entity_id uuid NOT NULL REFERENCES food_semantics.entities(id) ON DELETE CASCADE,
  locale text NOT NULL,
  label text NOT NULL,
  normalized text NOT NULL,
  label_type text NOT NULL,
  PRIMARY KEY(entity_id, locale, normalized, label_type)
);

CREATE INDEX IF NOT EXISTS food_semantics_labels_lookup
  ON food_semantics.labels(locale, normalized);

CREATE INDEX IF NOT EXISTS food_semantics_labels_trgm
  ON food_semantics.labels USING gin(normalized gin_trgm_ops);

CREATE TABLE IF NOT EXISTS food_semantics.relations (
  source_entity_id uuid NOT NULL REFERENCES food_semantics.entities(id) ON DELETE CASCADE,
  relation text NOT NULL,
  target_source_key text NOT NULL,
  target_source_id text NOT NULL,
  PRIMARY KEY(source_entity_id, relation, target_source_key, target_source_id)
);

CREATE INDEX IF NOT EXISTS food_semantics_relations_target
  ON food_semantics.relations(target_source_key, target_source_id, relation);

CREATE TABLE IF NOT EXISTS food_semantics.product_mappings (
  product_id text PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES food_semantics.entities(id),
  source text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_semantics.resolution_cache (
  input_normalized text NOT NULL,
  source_locale text NOT NULL,
  target_locale text NOT NULL,
  input_text text NOT NULL,
  entity_id uuid NOT NULL REFERENCES food_semantics.entities(id),
  translated_text text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  status text NOT NULL,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(input_normalized, source_locale, target_locale)
);

CREATE INDEX IF NOT EXISTS food_semantics_cache_entity
  ON food_semantics.resolution_cache(entity_id);
