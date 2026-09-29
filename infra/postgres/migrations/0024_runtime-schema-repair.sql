BEGIN;

-- Idempotent runtime repair for databases created by older local builds.
-- This migration deliberately does not assume that migration 0022 was executed:
-- existing local volumes may already contain its version marker while the profile
-- columns were absent due to an interrupted/incorrect migration runner.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique
  ON public.users (lower(email))
  WHERE email IS NOT NULL AND status <> 'ERASED';

GRANT USAGE ON SCHEMA public TO dispensa_app, dispensa_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users, public.families, public.family_memberships
  TO dispensa_app, dispensa_worker;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO dispensa_app, dispensa_worker;

COMMIT;
