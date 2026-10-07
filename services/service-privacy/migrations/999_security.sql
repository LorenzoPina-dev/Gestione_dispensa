GRANT USAGE ON SCHEMA public TO privacy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO privacy_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO privacy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO privacy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO privacy_app;

ALTER TABLE privacy_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_consents_user_scope ON privacy_consents;
CREATE POLICY privacy_consents_user_scope ON privacy_consents
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE privacy_erasure_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_erasure_family_scope ON privacy_erasure_requests;
CREATE POLICY privacy_erasure_family_scope ON privacy_erasure_requests
  FOR ALL
  USING (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE privacy_export_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_export_family_scope ON privacy_export_jobs;
CREATE POLICY privacy_export_family_scope ON privacy_export_jobs
  FOR ALL
  USING (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    AND owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE export_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_artifacts_family_scope ON export_artifacts;
CREATE POLICY privacy_artifacts_family_scope ON export_artifacts
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_audit_scope ON audit_events;
CREATE POLICY privacy_audit_scope ON audit_events
  FOR ALL
  USING (
    family_id IS NULL
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    family_id IS NULL
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_idempotency_scope ON idempotency_keys;
CREATE POLICY privacy_idempotency_scope ON idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  );

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_outbox_scope ON outbox_events;
CREATE POLICY privacy_outbox_scope ON outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
