ALTER TABLE public.employment_links
  ADD COLUMN remuneration_type text DEFAULT NULL,
  ADD COLUMN has_transport_allowance boolean NOT NULL DEFAULT false,
  ADD COLUMN has_meal_allowance boolean NOT NULL DEFAULT false;