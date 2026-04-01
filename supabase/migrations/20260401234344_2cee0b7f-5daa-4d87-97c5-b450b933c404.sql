ALTER TABLE public.worker_documents
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS category text;