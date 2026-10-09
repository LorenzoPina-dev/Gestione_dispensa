GRANT USAGE ON SCHEMA notifications_domain TO notifications_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notifications_domain TO notifications_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA notifications_domain TO notifications_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notifications_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications_domain GRANT USAGE, SELECT ON SEQUENCES TO notifications_app;

ALTER TABLE notifications_domain.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_user_scope ON notifications_domain.notifications;
CREATE POLICY notifications_user_scope ON notifications_domain.notifications
  FOR ALL
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  );

ALTER TABLE notifications_domain.preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_preferences_user_scope ON notifications_domain.preferences;
CREATE POLICY notifications_preferences_user_scope ON notifications_domain.preferences
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE notifications_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_outbox_scope ON notifications_domain.outbox_events;
CREATE POLICY notifications_outbox_scope ON notifications_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

ALTER TABLE notifications_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_idempotency_scope ON notifications_domain.idempotency_keys;
CREATE POLICY notifications_idempotency_scope ON notifications_domain.idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  );
