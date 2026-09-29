BEGIN;

-- Keycloak is the source of authentication identity, while PostgreSQL keeps the
-- application profile needed by Family/Inventory/etc. The original users table
-- only contained lifecycle fields, but service-identity upserts these profile
-- columns on every authenticated request.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (lower(email))
  WHERE email IS NOT NULL AND status <> 'ERASED';

COMMIT;
