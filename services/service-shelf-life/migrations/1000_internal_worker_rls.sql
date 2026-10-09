-- Internal Shelf-Life workers are authenticated by the service token on the
-- dedicated internal HTTP routes. The transaction-local app.internal_service flag
-- lets those routes operate across families without weakening user-scoped RLS.

DROP POLICY IF EXISTS shelf_life_predictions_scope ON shelf_life_domain.predictions;
CREATE POLICY shelf_life_predictions_scope ON shelf_life_domain.predictions
  FOR ALL
  USING (
    current_setting('app.internal_service', true) = 'true'
    OR (
      family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.internal_service', true) = 'true'
    OR (
      family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS shelf_life_outbox_scope ON shelf_life_domain.outbox_events;
CREATE POLICY shelf_life_outbox_scope ON shelf_life_domain.outbox_events
  FOR ALL
  USING (
    current_setting('app.internal_service', true) = 'true'
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.internal_service', true) = 'true'
    OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
  );
