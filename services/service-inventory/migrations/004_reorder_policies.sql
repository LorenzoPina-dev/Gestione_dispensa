-- Reorder policy is family/product configuration, independent from current inventory rows.
CREATE TABLE IF NOT EXISTS reorder_policies (
  family_id uuid NOT NULL,
  product_id uuid NOT NULL,
  reorder_point numeric(14,3) NOT NULL CHECK (reorder_point >= 0),
  reorder_quantity numeric(14,3) NOT NULL CHECK (reorder_quantity > 0),
  unit varchar(16) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (family_id, product_id)
);

CREATE INDEX IF NOT EXISTS reorder_policies_family_enabled_idx
  ON reorder_policies(family_id, enabled, updated_at DESC);

-- Preserve any reorderPoint that may have been stored by the previous migration.
INSERT INTO reorder_policies(family_id, product_id, reorder_point, reorder_quantity, unit, created_at, updated_at)
SELECT DISTINCT ON (family_id, product_id)
  family_id,
  product_id,
  reorder_point,
  1,
  unit,
  created_at,
  updated_at
FROM pantry_items
WHERE reorder_point IS NOT NULL
ORDER BY family_id, product_id, updated_at DESC
ON CONFLICT (family_id, product_id) DO UPDATE
SET reorder_point = EXCLUDED.reorder_point,
    reorder_quantity = 1,
    unit = EXCLUDED.unit,
    updated_at = now(),
    version = reorder_policies.version + 1;

ALTER TABLE pantry_items
  DROP COLUMN IF EXISTS reorder_point;
