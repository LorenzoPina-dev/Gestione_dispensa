CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('MANUAL', 'IMPORT', 'PROVIDER', 'OPERATOR')),
  name text NOT NULL,
  license_ref text,
  reliability_class text NOT NULL DEFAULT 'UNKNOWN' CHECK (reliability_class IN ('VERIFIED', 'TRUSTED', 'UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL CHECK (char_length(canonical_name) BETWEEN 1 AND 240),
  brand_id uuid REFERENCES brands(id),
  default_unit text NOT NULL CHECK (default_unit IN ('g', 'kg', 'ml', 'l', 'piece', 'pack')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  provenance_quality text NOT NULL DEFAULT 'UNKNOWN' CHECK (provenance_quality IN ('VERIFIED', 'IMPORTED', 'ESTIMATED', 'UNKNOWN')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  source_id uuid NOT NULL REFERENCES data_sources(id),
  identifier_type text NOT NULL CHECK (identifier_type IN ('EAN8', 'EAN13', 'GTIN12', 'GTIN14', 'SKU', 'BARCODE')),
  normalized_value text NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, identifier_type, normalized_value)
);

CREATE TABLE IF NOT EXISTS product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  locale text NOT NULL,
  alias text NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 240),
  source_id uuid NOT NULL REFERENCES data_sources(id),
  confidence numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS data_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES data_sources(id),
  observed_at timestamptz NOT NULL,
  source_version text,
  confidence numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  raw_ref text
);

CREATE INDEX IF NOT EXISTS product_identifiers_lookup_idx
  ON product_identifiers (identifier_type, normalized_value);
CREATE INDEX IF NOT EXISTS data_provenance_entity_idx
  ON data_provenance (entity_type, entity_id, observed_at DESC);