ALTER TABLE public.employment_link_documents
  ADD COLUMN IF NOT EXISTS link_group_worker_id uuid;