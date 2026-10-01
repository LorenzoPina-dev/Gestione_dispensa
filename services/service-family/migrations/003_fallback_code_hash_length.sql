ALTER TABLE invites
  ALTER COLUMN fallback_code TYPE varchar(64);

INSERT INTO schema_migrations(version)
VALUES ('003_fallback_code_hash_length')
ON CONFLICT DO NOTHING;
