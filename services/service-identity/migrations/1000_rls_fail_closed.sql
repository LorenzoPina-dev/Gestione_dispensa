-- Fail closed for the authenticated profile and idempotency paths.
-- Public register/reset/logout do not query these tables; profile and preference
-- handlers validate x-user-id before querying, and the gateway supplies that ID.
-- Outbox relays use the owning migration role; FORCE ROW LEVEL SECURITY is not enabled.
DROP POLICY IF EXISTS identity_users_scope ON users;
CREATE POLICY identity_users_scope ON users
  FOR ALL
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS identity_idempotency_scope ON idempotency_keys;
CREATE POLICY identity_idempotency_scope ON idempotency_keys
  FOR ALL
  USING (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS identity_outbox_scope ON outbox_events;
CREATE POLICY identity_outbox_scope ON outbox_events
  FOR ALL
  USING (
    family_id IS NULL
    AND aggregate_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    family_id IS NULL
    AND aggregate_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
