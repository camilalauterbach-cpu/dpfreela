ALTER TABLE public.employment_link_documents DROP CONSTRAINT IF EXISTS chk_document_owner;
ALTER TABLE public.employment_link_documents ADD CONSTRAINT chk_document_owner CHECK (
  num_nonnulls(employment_link_id, event_id, link_group_worker_id) = 1
);