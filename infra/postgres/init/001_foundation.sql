CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL DEFAULT 'bootstrap',
  checksum text NOT NULL DEFAULT 'bootstrap',
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name, checksum)
VALUES ('0000_bootstrap', 'bootstrap', 'bootstrap')
ON CONFLICT (version) DO NOTHING;