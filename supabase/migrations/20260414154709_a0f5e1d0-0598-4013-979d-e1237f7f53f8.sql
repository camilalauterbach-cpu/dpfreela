
-- Add company_id to employment_links
ALTER TABLE public.employment_links
ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL DEFAULT NULL;

-- Index for performance
CREATE INDEX idx_employment_links_company_id ON public.employment_links(company_id);
