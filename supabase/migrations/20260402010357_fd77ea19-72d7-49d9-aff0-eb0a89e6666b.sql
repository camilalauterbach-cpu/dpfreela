ALTER TABLE public.employment_link_documents
  ADD COLUMN category text,
  ADD COLUMN status text NOT NULL DEFAULT 'pending';