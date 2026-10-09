GRANT USAGE ON SCHEMA public TO jobs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jobs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO jobs_app;

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jobs_family_scope ON jobs;
CREATE POLICY jobs_family_scope ON jobs
  FOR ALL
  USING (
    family_id IS NULL
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    family_id IS NULL
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );

ALTER TABLE job_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_attempts_family_scope ON job_attempts;
CREATE POLICY job_attempts_family_scope ON job_attempts
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_attempts.job_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_attempts.job_id
  ));

ALTER TABLE dead_letter_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dead_letter_family_scope ON dead_letter_jobs;
CREATE POLICY dead_letter_family_scope ON dead_letter_jobs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = dead_letter_jobs.job_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = dead_letter_jobs.job_id
  ));
