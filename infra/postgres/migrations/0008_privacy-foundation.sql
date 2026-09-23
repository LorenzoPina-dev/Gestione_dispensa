CREATE TABLE IF NOT EXISTS privacy_erasure_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (family_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS privacy_erasure_requests_family_idx
  ON privacy_erasure_requests (family_id, status);

CREATE TABLE IF NOT EXISTS privacy_consents (
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL,
  granted boolean NOT NULL,
  consent_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purpose)
);

-- Local-profile stand-in for object storage: export content lives in its own
-- table (rather than a real MinIO/S3 bucket) so PrivacyExportService and
-- PrivacyExportWorker can run end-to-end without external storage. The
-- artifact row is created independently of privacy_export_jobs.artifact_id
-- (which only gets set once the artifact exists) so there is no ordering
-- dependency between "write the content" and "point the job at it" -- an
-- earlier version of this migration tried to store content inline on
-- privacy_export_jobs matched by artifact_id, which does not exist on any
-- row yet at write time; caught by running the full export flow against a
-- live PostgreSQL instance.
CREATE TABLE IF NOT EXISTS export_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  content jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privacy_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED')),
  artifact_id uuid REFERENCES export_artifacts(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS privacy_export_jobs_family_idx
  ON privacy_export_jobs (family_id, status);
