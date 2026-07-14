ALTER TABLE public.employment_link_documents DROP CONSTRAINT IF EXISTS chk_document_owner;
ALTER TABLE public.employment_link_documents ADD CONSTRAINT chk_document_owner CHECK (
  employment_link_id IS NOT NULL
  OR event_id IS NOT NULL
  OR link_group_worker_id IS NOT NULL
);