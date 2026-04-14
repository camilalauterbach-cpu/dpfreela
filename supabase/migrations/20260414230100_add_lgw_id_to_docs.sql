-- Add link_group_worker_id to employment_link_documents for the new group model
-- Existing documents using employment_link_id remain untouched
ALTER TABLE public.employment_link_documents
  ADD COLUMN IF NOT EXISTS link_group_worker_id uuid;
