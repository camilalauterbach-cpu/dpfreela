ALTER TABLE public.job_roles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_job_roles_deleted_at ON public.job_roles(deleted_at);