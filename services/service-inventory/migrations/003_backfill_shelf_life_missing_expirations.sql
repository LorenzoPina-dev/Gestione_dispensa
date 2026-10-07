-- Re-emit the canonical Inventory received event for existing pantry
-- items that still have no expiration. Shelf-Life remains the owner of the
-- calculation; Inventory only republishes its own domain fact.
-- A unique marker prevents repeated backfill events on later restarts.

INSERT INTO outbox_events
  (id,event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  'inventory.stock.received.v1',
  1,
  i.id,
  i.family_id,
  gen_random_uuid(),
  COALESCE(i.added_at, now()),
  jsonb_build_object(
    'itemId', i.id,
    'productId', i.product_id,
    'actorUserId', actor.actor_user_id,
    'location', i.location,
    'openedAt', i.opened_at,
    'quantity', i.quantity::text,
    'unit', i.unit,
    'expiresAt', NULL,
    'expirationSource', NULL,
    'occurredAt', COALESCE(i.added_at, now()),
    'storedOn', COALESCE(i.added_at, now()),
    'shelfLifeBackfill', 'v1'
  ),
  now()
FROM pantry_items i
JOIN LATERAL (
  SELECT m.actor_user_id
  FROM movements m
  WHERE m.pantry_item_id = i.id
    AND m.type = 'add'
  ORDER BY m.occurred_at ASC, m.created_at ASC
  LIMIT 1
) actor ON true
WHERE i.expires_at IS NULL
  AND i.expiration_source IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM outbox_events existing
    WHERE existing.event_type = 'inventory.stock.received.v1'
      AND existing.aggregate_id = i.id
      AND existing.payload->>'shelfLifeBackfill' = 'v1'
  );
