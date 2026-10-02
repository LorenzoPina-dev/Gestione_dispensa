-- Persist the exact prediction inputs so a queued prediction can be recovered
-- after Redis loss, worker restart, or a crash between DB commit and queue publish.
ALTER TABLE shelf_life_domain.predictions
  ADD COLUMN IF NOT EXISTS storage varchar(32) NULL CHECK(storage IN ('PANTRY','FRIDGE','FREEZER','CELLAR','OTHER')),
  ADD COLUMN IF NOT EXISTS opened boolean NULL,
  ADD COLUMN IF NOT EXISTS category varchar(120) NULL,
  ADD COLUMN IF NOT EXISTS stored_on timestamptz NULL;

CREATE INDEX IF NOT EXISTS shelf_predictions_recovery_idx
  ON shelf_life_domain.predictions(status,created_at)
  WHERE status='queued';

