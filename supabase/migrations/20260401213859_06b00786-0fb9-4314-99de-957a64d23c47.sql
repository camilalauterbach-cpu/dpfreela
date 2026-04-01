
-- Payroll batches
CREATE TABLE public.payroll_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  batch_name text NOT NULL,
  reference_month text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','completed','cancelled')),
  total_amount numeric(14,2),
  paid_at timestamptz,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_batches ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_payroll_batches_updated_at
  BEFORE UPDATE ON public.payroll_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_payroll_batches_event ON public.payroll_batches (event_id);
CREATE INDEX idx_payroll_batches_status ON public.payroll_batches (status);

-- Payroll batch items
CREATE TABLE public.payroll_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.payroll_batches(id) ON DELETE CASCADE NOT NULL,
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  employment_link_id uuid REFERENCES public.employment_links(id) ON DELETE SET NULL,
  base_amount numeric(12,2) NOT NULL DEFAULT 0,
  overtime_amount numeric(12,2) DEFAULT 0,
  deductions numeric(12,2) DEFAULT 0,
  bonuses numeric(12,2) DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','cancelled')),
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_batch_items ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_payroll_batch_items_updated_at
  BEFORE UPDATE ON public.payroll_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_batch_items_batch ON public.payroll_batch_items (batch_id);
CREATE INDEX idx_batch_items_worker ON public.payroll_batch_items (worker_id);

-- Payment receipts
CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.payroll_batches(id) ON DELETE SET NULL,
  item_id uuid REFERENCES public.payroll_batch_items(id) ON DELETE SET NULL,
  receipt_number text,
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_must_have_reference CHECK (batch_id IS NOT NULL OR item_id IS NOT NULL)
);

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_payment_receipts_updated_at
  BEFORE UPDATE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_receipts_batch ON public.payment_receipts (batch_id);
CREATE INDEX idx_receipts_item ON public.payment_receipts (item_id);

-- Change logs (immutable audit trail)
CREATE TABLE public.change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.change_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_change_logs_table_record ON public.change_logs (table_name, record_id);
CREATE INDEX idx_change_logs_changed_by ON public.change_logs (changed_by);
CREATE INDEX idx_change_logs_created_at ON public.change_logs (created_at);

-- Saved filters
CREATE TABLE public.saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  filter_name text NOT NULL,
  table_name text NOT NULL,
  filter_config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_saved_filters_updated_at
  BEFORE UPDATE ON public.saved_filters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
