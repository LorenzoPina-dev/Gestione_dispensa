-- Nutrition outbox contains both personal events (family_id NULL) and
-- family-scoped events produced while processing inventory events.
-- Keep RLS enabled while allowing each form only within its actor scope.
ALTER TABLE nutrition_domain.outbox_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nutrition_outbox_scope ON nutrition_domain.outbox_events;

CREATE POLICY nutrition_outbox_scope ON nutrition_domain.outbox_events
  FOR ALL
  USING (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR (
      family_id IS NULL
      AND payload ->> 'actorUserId' = NULLIF(current_setting('app.user_id', true), '')
    )
  )
  WITH CHECK (
    family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
    OR (
      family_id IS NULL
      AND payload ->> 'actorUserId' = NULLIF(current_setting('app.user_id', true), '')
    )
  );
