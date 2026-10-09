GRANT USAGE ON SCHEMA public TO identity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO identity_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO identity_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_users_scope ON users;
CREATE POLICY identity_users_scope ON users
  FOR ALL
  USING (
    id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.user_id', true) = ''
  )
  WITH CHECK (
    current_setting('app.user_id', true) = ''
    OR id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_idempotency_scope ON idempotency_keys;
CREATE POLICY identity_idempotency_scope ON idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.user_id', true) = ''
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.user_id', true) = ''
  );

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_outbox_scope ON outbox_events;
CREATE POLICY identity_outbox_scope ON outbox_events
  FOR ALL
  USING (
    family_id IS NULL
    AND (
      current_setting('app.user_id', true) = ''
      OR aggregate_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    family_id IS NULL
    AND (
      current_setting('app.user_id', true) = ''
      OR aggregate_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
