
-- Companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  cnpj text UNIQUE,
  address text,
  city text,
  state text,
  phone text,
  email text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  location text,
  city text,
  state text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','confirmed','in_progress','completed','cancelled')),
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Workers
CREATE TABLE public.workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  nickname text,
  cpf text NOT NULL UNIQUE CHECK (cpf ~ '^\d{11}$'),
  rg text,
  birth_date date,
  gender text,
  marital_status text,
  nationality text DEFAULT 'Brasileira',
  phone_main text,
  phone_secondary text,
  email text,
  address text,
  neighborhood text,
  city text,
  state text,
  zip_code text,
  emergency_contact_name text,
  emergency_contact_phone text,
  shirt_size text,
  shoe_size text,
  blood_type text,
  allergies text,
  medical_conditions text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workers_updated_at
  BEFORE UPDATE ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_workers_full_name ON public.workers USING gin (to_tsvector('portuguese', full_name));
CREATE INDEX idx_workers_nickname ON public.workers (nickname);
CREATE INDEX idx_workers_phone_main ON public.workers (phone_main);
CREATE INDEX idx_workers_cpf ON public.workers (cpf);
CREATE INDEX idx_events_company ON public.events (company_id);
CREATE INDEX idx_events_status ON public.events (status);
