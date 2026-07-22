ALTER TABLE public.link_group_workers ADD COLUMN IF NOT EXISTS job_role_id uuid REFERENCES public.job_roles(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_link_group_workers_job_role_id ON public.link_group_workers(job_role_id);

ALTER TABLE public.document_types ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_document_types_display_order ON public.document_types(display_order);