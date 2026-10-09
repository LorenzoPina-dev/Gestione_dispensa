ALTER TABLE dietary_preferences
  ADD COLUMN IF NOT EXISTS uncertainty_policy varchar(16) NOT NULL DEFAULT 'EXCLUDE';

ALTER TABLE dietary_preferences
  DROP CONSTRAINT IF EXISTS dietary_preferences_uncertainty_policy_ck;

ALTER TABLE dietary_preferences
  ADD CONSTRAINT dietary_preferences_uncertainty_policy_ck
  CHECK (uncertainty_policy IN ('WARN','EXCLUDE'));

UPDATE dietary_preferences
SET uncertainty_policy = 'EXCLUDE'
WHERE uncertainty_policy IS NULL;
