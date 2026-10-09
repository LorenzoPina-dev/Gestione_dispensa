ALTER TABLE nutrition_domain.diary_entries
  ADD COLUMN IF NOT EXISTS family_id uuid NULL;

CREATE INDEX IF NOT EXISTS nutrition_diary_family_date_idx
  ON nutrition_domain.diary_entries(family_id,date DESC,created_at DESC);

-- Legacy rows remain readable by their original actor, but every new diary row is family-scoped.
ALTER TABLE nutrition_domain.diary_entries
  DROP CONSTRAINT IF EXISTS nutrition_diary_inventory_family_chk;

ALTER TABLE nutrition_domain.diary_entries
  ADD CONSTRAINT nutrition_diary_inventory_family_chk
  CHECK (source <> 'inventory' OR family_id IS NOT NULL) NOT VALID;

ALTER TABLE nutrition_domain.diary_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nutrition_diary_user_scope ON nutrition_domain.diary_entries;
DROP POLICY IF EXISTS nutrition_diary_family_scope ON nutrition_domain.diary_entries;

CREATE POLICY nutrition_diary_family_scope ON nutrition_domain.diary_entries
  FOR ALL
  USING (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR (
      family_id IS NULL
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );
