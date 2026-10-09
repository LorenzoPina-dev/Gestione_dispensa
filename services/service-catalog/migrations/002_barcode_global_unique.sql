-- A barcode is globally unambiguous inside the authoritative Catalog.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_identifiers_identifier
  ON product_identifiers(identifier_type, normalized_value);

INSERT INTO schema_migrations(version) VALUES ('002_barcode_global_unique')
ON CONFLICT DO NOTHING;
