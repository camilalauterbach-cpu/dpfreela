ALTER TABLE public.events
  ADD COLUMN requires_epi_form boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_service_order boolean NOT NULL DEFAULT false,
  ADD COLUMN required_nrs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN required_nrs_other text;