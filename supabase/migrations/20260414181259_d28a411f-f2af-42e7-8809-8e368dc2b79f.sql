ALTER TABLE public.worker_payment_methods
  ADD COLUMN IF NOT EXISTS holder_name text,
  ADD COLUMN IF NOT EXISTS holder_cpf text;