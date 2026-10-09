BEGIN;

CREATE TEMP TABLE rls_test_users(user_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rls_test_users VALUES (gen_random_uuid()), (gen_random_uuid());

INSERT INTO users(id,subject,email)
SELECT user_id, 'rls-test-' || user_id::text, NULL
FROM rls_test_users;

INSERT INTO idempotency_keys(key,actor_user_id,request_hash,status,expires_at)
SELECT 'rls-test-' || user_id::text, user_id, repeat('a',64), 'processing', now() + interval '1 hour'
FROM rls_test_users;

INSERT INTO outbox_events(id,event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload)
SELECT gen_random_uuid(), gen_random_uuid(), 'RlsTest', 1, user_id, NULL, gen_random_uuid(), now(), '{}'::jsonb
FROM rls_test_users;

SELECT set_config('rls.test.user1', (SELECT user_id::text FROM rls_test_users ORDER BY user_id LIMIT 1), true);
SELECT set_config('rls.test.user2', (SELECT user_id::text FROM rls_test_users ORDER BY user_id DESC LIMIT 1), true);

SET LOCAL ROLE identity_app;
SELECT set_config('app.user_id', '', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users) THEN
    RAISE EXCEPTION 'RLS failure: users are visible with missing user context';
  END IF;
  IF EXISTS (SELECT 1 FROM idempotency_keys) THEN
    RAISE EXCEPTION 'RLS failure: idempotency rows are visible with missing user context';
  END IF;
  IF EXISTS (SELECT 1 FROM outbox_events) THEN
    RAISE EXCEPTION 'RLS failure: outbox rows are visible with missing user context';
  END IF;
END;
$$;

SELECT set_config('app.user_id', current_setting('rls.test.user1'), true);

DO $$
DECLARE
  own_id uuid := current_setting('app.user_id')::uuid;
  other_id uuid;
BEGIN
  other_id := current_setting('rls.test.user2')::uuid;

  IF (SELECT count(*) FROM users WHERE id = own_id) <> 1
     OR EXISTS (SELECT 1 FROM users WHERE id = other_id) THEN
    RAISE EXCEPTION 'RLS failure: users are not isolated by app.user_id';
  END IF;
  IF (SELECT count(*) FROM idempotency_keys WHERE actor_user_id = own_id) <> 1
     OR EXISTS (SELECT 1 FROM idempotency_keys WHERE actor_user_id = other_id) THEN
    RAISE EXCEPTION 'RLS failure: idempotency rows are not isolated by app.user_id';
  END IF;
  IF (SELECT count(*) FROM outbox_events WHERE aggregate_id = own_id) <> 1
     OR EXISTS (SELECT 1 FROM outbox_events WHERE aggregate_id = other_id) THEN
    RAISE EXCEPTION 'RLS failure: outbox rows are not isolated by app.user_id';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE identity;
SELECT set_config('app.user_id', '', true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outbox_events WHERE event_type = 'RlsTest') THEN
    RAISE EXCEPTION 'RLS failure: identity relay role cannot read outbox rows';
  END IF;
END;
$$;

ROLLBACK;
