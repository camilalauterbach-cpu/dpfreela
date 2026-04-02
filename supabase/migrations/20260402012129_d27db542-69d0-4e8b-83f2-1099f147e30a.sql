ALTER TABLE public.employment_links
  ADD COLUMN IF NOT EXISTS work_days_mode text NOT NULL DEFAULT 'continuous',
  ADD COLUMN IF NOT EXISTS specific_work_dates date[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS work_days_notes text;