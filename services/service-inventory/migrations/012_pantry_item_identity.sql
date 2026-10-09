-- Enforce one current-stock row per physical stock identity.
-- Different locations or lots remain separate; absent nullable values are treated
-- as the same identity so repeated manual adds cannot create duplicate current rows.
WITH ranked AS (
  SELECT
    p.id,
    first_value(p.id) OVER (
      PARTITION BY p.family_id, p.product_id, p.unit, p.location, p.lot_id, p.lot_code
      ORDER BY p.updated_at DESC, p.created_at ASC, p.id
    ) AS keep_id
  FROM pantry_items p
),
duplicates AS (
  SELECT id, keep_id
  FROM ranked
  WHERE id <> keep_id
)
UPDATE movements m
SET pantry_item_id = d.keep_id
FROM duplicates d
WHERE m.pantry_item_id = d.id;

WITH ranked AS (
  SELECT
    p.*,
    first_value(p.id) OVER (
      PARTITION BY p.family_id, p.product_id, p.unit, p.location, p.lot_id, p.lot_code
      ORDER BY p.updated_at DESC, p.created_at ASC, p.id
    ) AS keep_id
  FROM pantry_items p
),
aggregated AS (
  SELECT
    keep_id,
    SUM(quantity) AS quantity,
    MIN(opened_at) AS opened_at,
    CASE
      WHEN bool_or(expiration_source = 'declared')
        THEN MIN(expires_at) FILTER (WHERE expiration_source = 'declared')
      ELSE MIN(expires_at) FILTER (WHERE expiration_source = 'estimated')
    END AS expires_at,
    CASE
      WHEN bool_or(expiration_source = 'declared') THEN 'declared'
      WHEN bool_or(expiration_source = 'estimated') THEN 'estimated'
      ELSE NULL
    END AS expiration_source,
    MIN(added_at) AS added_at,
    MIN(created_at) AS created_at,
    MAX(updated_at) AS updated_at,
    GREATEST(MAX(version), 1) + CASE WHEN COUNT(*) > 1 THEN 1 ELSE 0 END AS version
  FROM ranked
  GROUP BY keep_id
)
UPDATE pantry_items p
SET quantity = a.quantity,
    opened_at = a.opened_at,
    expires_at = a.expires_at,
    expiration_source = a.expiration_source,
    added_at = a.added_at,
    created_at = a.created_at,
    updated_at = a.updated_at,
    version = a.version
FROM aggregated a
WHERE p.id = a.keep_id;

WITH ranked AS (
  SELECT
    p.id,
    first_value(p.id) OVER (
      PARTITION BY p.family_id, p.product_id, p.unit, p.location, p.lot_id, p.lot_code
      ORDER BY p.updated_at DESC, p.created_at ASC, p.id
    ) AS keep_id
  FROM pantry_items p
)
DELETE FROM pantry_items p
USING ranked r
WHERE p.id = r.id
  AND r.id <> r.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS pantry_items_identity_uq
  ON pantry_items (family_id, product_id, unit, location, lot_id, lot_code)
  NULLS NOT DISTINCT;
