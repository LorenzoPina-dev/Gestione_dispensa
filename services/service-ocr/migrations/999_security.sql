GRANT USAGE ON SCHEMA ocr_domain TO ocr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ocr_domain TO ocr_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ocr_domain TO ocr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ocr_domain GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ocr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ocr_domain GRANT USAGE, SELECT ON SEQUENCES TO ocr_app;

ALTER TABLE ocr_domain.ocr_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_jobs_scope ON ocr_domain.ocr_jobs;
CREATE POLICY ocr_jobs_scope ON ocr_domain.ocr_jobs
  FOR ALL
  USING (
    (family_id IS NOT NULL AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    (family_id IS NOT NULL AND family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE ocr_domain.ocr_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_drafts_scope ON ocr_domain.ocr_drafts;
CREATE POLICY ocr_drafts_scope ON ocr_domain.ocr_drafts
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM ocr_domain.ocr_jobs j
    WHERE j.id = ocr_domain.ocr_drafts.job_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ocr_domain.ocr_jobs j
    WHERE j.id = ocr_domain.ocr_drafts.job_id
  ));

ALTER TABLE ocr_domain.ocr_draft_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_draft_items_scope ON ocr_domain.ocr_draft_items;
CREATE POLICY ocr_draft_items_scope ON ocr_domain.ocr_draft_items
  FOR ALL
  USING (EXISTS (
    SELECT 1
      FROM ocr_domain.ocr_drafts d
      JOIN ocr_domain.ocr_jobs j ON j.id = d.job_id
     WHERE d.id = ocr_domain.ocr_draft_items.draft_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM ocr_domain.ocr_drafts d
      JOIN ocr_domain.ocr_jobs j ON j.id = d.job_id
     WHERE d.id = ocr_domain.ocr_draft_items.draft_id
  ));

ALTER TABLE ocr_domain.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_idempotency_scope ON ocr_domain.idempotency_keys;
CREATE POLICY ocr_idempotency_scope ON ocr_domain.idempotency_keys
  FOR ALL
  USING (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  )
  WITH CHECK (
    actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (family_id IS NULL OR family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  );

ALTER TABLE ocr_domain.outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocr_outbox_scope ON ocr_domain.outbox_events;
CREATE POLICY ocr_outbox_scope ON ocr_domain.outbox_events
  FOR ALL
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);
