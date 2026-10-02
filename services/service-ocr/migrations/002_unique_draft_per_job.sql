-- One OCR job produces at most one authoritative draft.
-- Retries must update/reuse the same draft rather than append duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS ocr_drafts_job_unique
  ON ocr_domain.ocr_drafts(job_id);

