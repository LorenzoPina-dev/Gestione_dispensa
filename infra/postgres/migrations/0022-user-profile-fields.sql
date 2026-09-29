BEGIN;

-- OIDC-backed profiles need the mutable profile attributes consumed by the web
-- bootstrap. They intentionally live in the local users table, while Keycloak
-- remains the identity provider.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique
  ON public.users (lower(email))
  WHERE email IS NOT NULL AND status <> 'ERASED';


COMMIT;