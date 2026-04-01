
-- Worker dependents
CREATE TABLE public.worker_dependents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  full_name text NOT NULL,
  relationship text,
  birth_date date,
  cpf text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_dependents ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_worker_dependents_updated_at
  BEFORE UPDATE ON public.worker_dependents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_worker_dependents_worker ON public.worker_dependents (worker_id);

-- Worker payment methods
CREATE TABLE public.worker_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  method_type text NOT NULL CHECK (method_type IN ('bank_account', 'pix')),
  bank_name text,
  bank_code text,
  agency text,
  account_number text,
  account_type text CHECK (account_type IS NULL OR account_type IN ('checking', 'savings')),
  pix_key_type text CHECK (pix_key_type IS NULL OR pix_key_type IN ('cpf', 'phone', 'email', 'random')),
  pix_key text,
  is_preferred boolean NOT NULL DEFAULT false,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_worker_payment_methods_updated_at
  BEFORE UPDATE ON public.worker_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Partial unique index: only one preferred per worker (among non-deleted)
CREATE UNIQUE INDEX idx_worker_payment_preferred
  ON public.worker_payment_methods (worker_id)
  WHERE is_preferred = true AND deleted_at IS NULL;

CREATE INDEX idx_worker_payment_worker ON public.worker_payment_methods (worker_id);

-- Worker documents
CREATE TABLE public.worker_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  document_number text,
  issuing_authority text,
  issue_date date,
  expiry_date date,
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_documents ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_worker_documents_updated_at
  BEFORE UPDATE ON public.worker_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_worker_documents_worker ON public.worker_documents (worker_id);
CREATE INDEX idx_worker_documents_type ON public.worker_documents (document_type);
