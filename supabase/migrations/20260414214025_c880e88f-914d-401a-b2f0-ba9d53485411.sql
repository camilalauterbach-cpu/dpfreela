
-- =============================================
-- ETAPA 1: link_groups + link_group_workers
-- =============================================

-- Tabela agrupadora
CREATE TABLE public.link_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name text NOT NULL,
  event_id uuid NOT NULL,
  company_id uuid,
  status text NOT NULL DEFAULT 'draft',
  hire_date date,
  end_date date,
  work_days_mode text NOT NULL DEFAULT 'continuous',
  specific_work_dates date[] NOT NULL DEFAULT '{}',
  work_days_notes text,
  shift_type text,
  work_shift text,
  work_schedule text,
  call_time time,
  daily_hours numeric,
  weekly_hours numeric,
  supervisor_name text,
  assembly_point text,
  uniform_notes text,
  transport_notes text,
  meal_entitlement text,
  required_documents jsonb NOT NULL DEFAULT '{}',
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tabela de alocação individual
CREATE TABLE public.link_group_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_group_id uuid NOT NULL REFERENCES public.link_groups(id),
  worker_id uuid NOT NULL REFERENCES public.workers(id),
  job_role text,
  job_function text,
  department text,
  contract_type text,
  hire_date date,
  end_date date,
  remuneration_type text,
  daily_rate numeric,
  hourly_rate numeric,
  fixed_salary numeric,
  payment_frequency text,
  has_transport_allowance boolean NOT NULL DEFAULT false,
  transport_allowance numeric,
  has_meal_allowance boolean NOT NULL DEFAULT false,
  meal_allowance numeric,
  status text NOT NULL DEFAULT 'active',
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(link_group_id, worker_id)
);

-- RLS: link_groups
ALTER TABLE public.link_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_link_groups" ON public.link_groups FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_link_groups" ON public.link_groups FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[]));

CREATE POLICY "update_link_groups" ON public.link_groups FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[]));

CREATE POLICY "delete_link_groups" ON public.link_groups FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

-- RLS: link_group_workers
ALTER TABLE public.link_group_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_link_group_workers" ON public.link_group_workers FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_link_group_workers" ON public.link_group_workers FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[]));

CREATE POLICY "update_link_group_workers" ON public.link_group_workers FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[]));

CREATE POLICY "delete_link_group_workers" ON public.link_group_workers FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

-- Triggers de updated_at
CREATE TRIGGER update_link_groups_updated_at
  BEFORE UPDATE ON public.link_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_link_group_workers_updated_at
  BEFORE UPDATE ON public.link_group_workers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
