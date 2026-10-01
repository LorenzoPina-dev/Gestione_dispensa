-- Allinea lo schema al contratto esposto al frontend (idempotente: si può rieseguire).

-- Famiglie: impostazioni regionali e stato.
ALTER TABLE families ADD COLUMN IF NOT EXISTS locale varchar(16) NOT NULL DEFAULT 'it-IT';
ALTER TABLE families ADD COLUMN IF NOT EXISTS timezone varchar(64) NOT NULL DEFAULT 'Europe/Rome';
ALTER TABLE families ADD COLUMN IF NOT EXISTS unit_system varchar(16) NOT NULL DEFAULT 'METRIC';
ALTER TABLE families ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'ACTIVE';

-- Membri: stato e ruolo "viewer" (sola lettura).
ALTER TABLE members ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check CHECK (role IN ('owner','admin','member','viewer'));

-- Inviti: non più legati a un'email (QR / codice alternativo), con ruolo "viewer".
ALTER TABLE invites ALTER COLUMN email DROP NOT NULL;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS fallback_code varchar(16);
ALTER TABLE invites ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ('admin','member','viewer'));
CREATE UNIQUE INDEX IF NOT EXISTS invites_pending_fallback_code_idx ON invites(fallback_code) WHERE status = 'pending';

-- Tentativi di ingresso: lo stesso invito viene prima "risolto" (QR o codice) e poi accettato.
CREATE TABLE IF NOT EXISTS join_attempts(
  id uuid PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  browser_binding_hash varchar(128) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN ('PENDING_REVIEW','ACCEPTED','REJECTED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS join_attempts_user_idx ON join_attempts(user_id);
