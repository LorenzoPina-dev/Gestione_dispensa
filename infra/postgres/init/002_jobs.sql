CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NULL,
  capability text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEGRADED')),
  idempotency_key text NOT NULL,
  current_attempt integer NOT NULL DEFAULT 0 CHECK (current_attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL,
  result_ref text NULL,
  last_error_code text NULL,
  last_error_class text NULL CHECK (last_error_class IN ('TRANSIENT', 'PERMANENT')),
  trace_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capability, idempotency_key)
);

CREATE TABLE IF NOT EXISTS job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  status text NOT NULL,
  error_code text NULL,
  error_class text NULL CHECK (error_class IN ('TRANSIENT', 'PERMANENT')),
  duration_ms integer NULL,
  UNIQUE (job_id, attempt)
);

CREATE TABLE IF NOT EXISTS inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name text NOT NULL,
  event_id text NOT NULL,
  processed_at timestamptz NULL,
  outcome text NULL,
  UNIQUE (consumer_name, event_id)
);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  queue text NOT NULL,
  reason text NOT NULL,
  error_code text NULL,
  error_class text NULL CHECK (error_class IN ('TRANSIENT', 'PERMANENT')),
  attempts integer NOT NULL,
  replay_count integer NOT NULL DEFAULT 0,
  failed_at timestamptz NOT NULL,
  original_created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_pending_idx ON jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS dead_letter_jobs_failed_idx ON dead_letter_jobs (failed_at);

INSERT INTO schema_migrations (version)
VALUES ('002_jobs')
ON CONFLICT (version) DO NOTHING;
