
ALTER TABLE employment_link_documents
  ADD COLUMN IF NOT EXISTS event_id uuid;

ALTER TABLE employment_link_documents
  ALTER COLUMN employment_link_id DROP NOT NULL;

-- Constraint: todo registro deve ter employment_link_id OU event_id
ALTER TABLE employment_link_documents
  ADD CONSTRAINT chk_document_owner
  CHECK (employment_link_id IS NOT NULL OR event_id IS NOT NULL);
