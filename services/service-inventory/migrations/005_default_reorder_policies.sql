-- Default reorder behavior for all products already tracked by Inventory.
-- A product with no explicit policy is considered reorderable at zero stock and
-- defaults to one unit to buy.

INSERT INTO reorder_policies (
  family_id,
  product_id,
  reorder_point,
  reorder_quantity,
  unit,
  enabled,
  created_at,
  updated_at
)
SELECT DISTINCT ON (family_id, product_id)
  i.family_id,
  i.product_id,
  0,
  1,
  i.unit,
  true,
  i.created_at,
  i.updated_at
FROM pantry_items i
WHERE NOT EXISTS (
  SELECT 1
  FROM reorder_policies p
  WHERE p.family_id = i.family_id
    AND p.product_id = i.product_id
)
ORDER BY family_id, product_id, i.updated_at DESC, i.created_at DESC;

-- Products whose current pantry rows were already exhausted before this policy
-- existed have no pantry_items row anymore. Reconstruct a zero-stock policy from
-- the latest movement so the normal outbox -> Redis -> Shopping flow can recover
-- the missing low-stock suggestion.
INSERT INTO reorder_policies (
  family_id,
  product_id,
  reorder_point,
  reorder_quantity,
  unit,
  enabled,
  created_at,
  updated_at
)
SELECT DISTINCT ON (m.family_id, m.product_id)
  m.family_id,
  m.product_id,
  0,
  1,
  m.unit,
  true,
  m.created_at,
  m.created_at
FROM movements m
WHERE m.type IN ('consume', 'waste')
  AND NOT EXISTS (
    SELECT 1
    FROM pantry_items i
    WHERE i.family_id = m.family_id
      AND i.product_id = m.product_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM reorder_policies p
    WHERE p.family_id = m.family_id
      AND p.product_id = m.product_id
  )
ORDER BY m.family_id, m.product_id, m.occurred_at DESC, m.created_at DESC;

-- Emit one recoverable PantryLowStock event per reconstructed depleted product.
-- The event is idempotently consumed by worker-shopping using event_id.
INSERT INTO outbox_events (
  id,
  event_id,
  event_type,
  schema_version,
  aggregate_id,
  family_id,
  correlation_id,
  causation_id,
  occurred_at,
  payload,
  created_at
)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  'PantryLowStock',
  1,
  p.product_id,
  p.family_id,
  gen_random_uuid(),
  NULL,
  now(),
  jsonb_build_object(
    'productId', p.product_id,
    'availableQuantity', 0,
    'reorderPoint', p.reorder_point,
    'reorderQuantity', p.reorder_quantity,
    'unit', p.unit,
    'reason', 'DEFAULT_POLICY_BACKFILL',
    'dedupeKey', p.family_id::text || ':' || p.product_id::text
  ),
  now()
FROM reorder_policies p
WHERE p.enabled = true
  AND NOT EXISTS (
    SELECT 1
    FROM pantry_items i
    WHERE i.family_id = p.family_id
      AND i.product_id = p.product_id
  )
  AND EXISTS (
    SELECT 1
    FROM movements m
    WHERE m.family_id = p.family_id
      AND m.product_id = p.product_id
      AND m.type IN ('consume', 'waste')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM outbox_events e
    WHERE e.family_id = p.family_id
      AND e.event_type = 'PantryLowStock'
      AND e.payload->>'productId' = p.product_id::text
  );
