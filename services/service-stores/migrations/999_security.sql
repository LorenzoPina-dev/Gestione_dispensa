GRANT USAGE ON SCHEMA stores_domain TO stores_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stores_domain TO stores_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA stores_domain TO stores_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA stores_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stores_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA stores_domain GRANT USAGE, SELECT ON SEQUENCES TO stores_app;

ALTER TABLE stores_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_idempotency_scope ON stores_domain.idempotency_keys;
CREATE POLICY stores_idempotency_scope ON stores_domain.idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  );

ALTER TABLE stores_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_outbox_scope ON stores_domain.outbox_events;
CREATE POLICY stores_outbox_scope ON stores_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
