CREATE TABLE IF NOT EXISTS family_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  created_by uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('MANAGER', 'MEMBER', 'VIEWER')),
  token_hash bytea NOT NULL UNIQUE,
  fallback_code_hash bytea NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'REVOKED', 'CONSUMED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'CONSUMED' AND consumed_at IS NOT NULL) OR status <> 'CONSUMED'),
  CHECK ((status = 'REVOKED' AND revoked_at IS NOT NULL) OR status <> 'REVOKED')
);

CREATE INDEX IF NOT EXISTS family_invites_active_idx
  ON family_invites (family_id, status, expires_at);

CREATE TABLE IF NOT EXISTS family_join_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES family_invites(id),
  user_id uuid REFERENCES users(id),
  browser_binding_hash bytea NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING_AUTHENTICATION', 'PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_join_attempts_user_idx
  ON family_join_attempts (user_id, state, expires_at);