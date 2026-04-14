
-- Add allowed_contract_types to link_groups
ALTER TABLE public.link_groups
  ADD COLUMN IF NOT EXISTS allowed_contract_types text NOT NULL DEFAULT 'both';

-- Add individual scheduling + category reference to link_group_workers
ALTER TABLE public.link_group_workers
  ADD COLUMN IF NOT EXISTS shift_type text,
  ADD COLUMN IF NOT EXISTS work_shift text,
  ADD COLUMN IF NOT EXISTS work_schedule text,
  ADD COLUMN IF NOT EXISTS call_time time WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS daily_hours numeric,
  ADD COLUMN IF NOT EXISTS weekly_hours numeric,
  ADD COLUMN IF NOT EXISTS category_reference_rate numeric;
