-- PostgreSQL integration fixture. Run only against a disposable database.
-- The transaction is rolled back so the fixture leaves no data behind.
BEGIN;

DO $$
DECLARE
  family_a uuid := '00000000-0000-0000-0000-000000000101';
  family_b uuid := '00000000-0000-0000-0000-000000000102';
  user_a uuid := '00000000-0000-0000-0000-000000000111';
  user_b uuid := '00000000-0000-0000-0000-000000000112';
  product_id uuid := '00000000-0000-0000-0000-000000000121';
  location_a uuid := '00000000-0000-0000-0000-000000000131';
  location_b uuid := '00000000-0000-0000-0000-000000000132';
  stock_a uuid := '00000000-0000-0000-0000-000000000141';
  list_a uuid := '00000000-0000-0000-0000-000000000151';
  job_id uuid := '00000000-0000-0000-0000-000000000161';
  event_id uuid := '00000000-0000-0000-0000-000000000171';
BEGIN
  INSERT INTO users (id) VALUES (user_a), (user_b);
  INSERT INTO families (
    id, display_name, creator_user_id, locale, timezone, unit_system
  )
  VALUES
    (family_a, 'Integrity Fixture A', user_a, 'it-IT', 'Europe/Rome', 'METRIC'),
    (family_b, 'Integrity Fixture B', user_b, 'it-IT', 'Europe/Rome', 'METRIC');
  INSERT INTO family_memberships (
    family_id, user_id, role, status, joined_at
  )
  VALUES
    (family_a, user_a, 'OWNER', 'ACTIVE', now()),
    (family_b, user_b, 'OWNER', 'ACTIVE', now());

  INSERT INTO data_sources (id, kind, name)
  VALUES ('00000000-0000-0000-0000-000000000122', 'MANUAL', 'Integrity Fixture');
  INSERT INTO products (id, canonical_name, default_unit)
  VALUES (product_id, 'Integrity fixture product', 'piece');
  INSERT INTO locations (id, family_id, name, kind)
  VALUES
    (location_a, family_a, 'A pantry', 'PANTRY'),
    (location_b, family_b, 'B pantry', 'PANTRY');
  INSERT INTO stock_items (
    id, family_id, product_id, location_id, current_quantity, unit
  )
  VALUES (stock_a, family_a, product_id, location_a, 2, 'piece');
  INSERT INTO shopping_lists (id, family_id, name, owner_user_id)
  VALUES (list_a, family_a, 'A shopping list', user_a);

  INSERT INTO jobs (
    id, family_id, capability, status, idempotency_key, next_attempt_at
  )
  VALUES (
    job_id, family_a, 'inventory.reconcile', 'PENDING', 'integrity-fixture-job', now()
  );
  INSERT INTO inbox_events (consumer_name, event_id)
  VALUES ('integrity-fixture-consumer', event_id::text);
  INSERT INTO outbox_events (
    event_id, event_type, event_version, aggregate_type, aggregate_id, family_id, payload
  )
  VALUES (
    event_id, 'inventory.updated', 1, 'stock_item', stock_a, family_a, '{}'::jsonb
  );
  INSERT INTO audit_events (
    family_id, actor_id, action, resource_type, resource_id, outcome, trace_id
  )
  VALUES (
    family_a, user_a, 'fixture.created', 'stock_item', stock_a, 'SUCCESS', 'integrity-fixture'
  );

  IF (SELECT count(*) FROM stock_items WHERE family_id = family_a) <> 1 THEN
    RAISE EXCEPTION 'family A stock fixture is not visible in its family scope';
  END IF;
  IF (SELECT count(*) FROM stock_items WHERE family_id = family_b) <> 0 THEN
    RAISE EXCEPTION 'family B can see family A stock fixture';
  END IF;
  IF (SELECT count(*) FROM audit_events WHERE family_id = family_b) <> 0 THEN
    RAISE EXCEPTION 'family B can see family A audit fixture';
  END IF;

  BEGIN
    INSERT INTO family_memberships (family_id, user_id, role, status, joined_at)
    VALUES (family_a, user_a, 'MEMBER', 'ACTIVE', now());
    RAISE EXCEPTION 'active membership uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO stock_movements (
      family_id, stock_item_id, kind, quantity, unit, source, client_operation_id, occurred_at
    )
    VALUES (
      family_a, stock_a, 'RECEIPT', 1, 'piece', 'fixture',
      '00000000-0000-0000-0000-000000000181', now()
    );
    INSERT INTO stock_movements (
      family_id, stock_item_id, kind, quantity, unit, source, client_operation_id, occurred_at
    )
    VALUES (
      family_a, stock_a, 'RECEIPT', 1, 'piece', 'fixture',
      '00000000-0000-0000-0000-000000000181', now()
    );
    RAISE EXCEPTION 'movement idempotency uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO stock_items (
      family_id, product_id, location_id, current_quantity, unit
    )
    VALUES (family_a, product_id, location_b, 1, 'piece');
    RAISE EXCEPTION 'cross-family location foreign key was not enforced';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO inbox_events (consumer_name, event_id)
    VALUES ('integrity-fixture-consumer', event_id::text);
    RAISE EXCEPTION 'inbox deduplication uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO outbox_events (
      event_id, event_type, event_version, aggregate_type, aggregate_id, family_id, payload
    )
    VALUES (
      event_id, 'inventory.updated', 1, 'stock_item', stock_a, family_a, '{}'::jsonb
    );
    RAISE EXCEPTION 'outbox event uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
