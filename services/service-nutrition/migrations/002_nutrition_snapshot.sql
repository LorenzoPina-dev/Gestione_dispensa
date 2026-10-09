ALTER TABLE nutrition_domain.diary_entries
  ADD COLUMN IF NOT EXISTS nutrition_snapshot jsonb NULL;
