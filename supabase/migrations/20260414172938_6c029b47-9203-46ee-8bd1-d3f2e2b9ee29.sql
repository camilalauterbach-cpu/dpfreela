ALTER TABLE public.employment_links 
ADD COLUMN IF NOT EXISTS required_documents jsonb NOT NULL DEFAULT '{}'::jsonb;