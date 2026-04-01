
-- Employment links (vínculos)
CREATE TABLE public.employment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  -- Role & function
  job_role text,
  job_function text,
  department text,
  -- Status & dates
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','suspended','completed','terminated','cancelled')),
  hire_date date,
  end_date date,
  -- Contract & pay
  contract_type text CHECK (contract_type IS NULL OR contract_type IN ('clt','pj','freelancer','temporary','intern')),
  daily_rate numeric(12,2),
  hourly_rate numeric(12,2),
  fixed_salary numeric(12,2),
  overtime_rate numeric(5,2),
  night_shift_rate numeric(5,2),
  hazard_pay numeric(12,2),
  meal_allowance numeric(12,2),
  transport_allowance numeric(12,2),
  other_allowances numeric(12,2),
  payment_frequency text CHECK (payment_frequency IS NULL OR payment_frequency IN ('daily','weekly','biweekly','monthly','per_event')),
  -- Work schedule
  shift_type text,
  work_shift text,
  work_schedule text,
  weekly_hours numeric(5,2),
  daily_hours numeric(5,2),
  work_days_pattern text,
  rest_days_pattern text,
  -- Operational
  supervisor_name text,
  supervisor_contact text,
  call_time time,
  assembly_point text,
  uniform_notes text,
  transport_notes text,
  meal_entitlement text,
  -- Logistics
  badge_number text,
  locker_number text,
  parking_spot text,
  -- General
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employment_links ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_employment_links_updated_at
  BEFORE UPDATE ON public.employment_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_employment_links_worker ON public.employment_links (worker_id);
CREATE INDEX idx_employment_links_event ON public.employment_links (event_id);
CREATE INDEX idx_employment_links_status ON public.employment_links (status);

-- Employment link documents
CREATE TABLE public.employment_link_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_link_id uuid REFERENCES public.employment_links(id) ON DELETE CASCADE NOT NULL,
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_number text,
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employment_link_documents ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_employment_link_documents_updated_at
  BEFORE UPDATE ON public.employment_link_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_link_documents_link ON public.employment_link_documents (employment_link_id);
CREATE INDEX idx_link_documents_worker ON public.employment_link_documents (worker_id);
