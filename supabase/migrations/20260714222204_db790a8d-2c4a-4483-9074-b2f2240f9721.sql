-- Migração A1: preparação de normalização de workers
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Colunas geradas
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS cpf_normalized text
    GENERATED ALWAYS AS (regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) STORED;

-- Novas colunas
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS linked_profile_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS merged_into_worker_id uuid REFERENCES public.workers(id),
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_by uuid,
  ADD COLUMN IF NOT EXISTS registration_status text NOT NULL DEFAULT 'incomplete';

ALTER TABLE public.workers
  DROP CONSTRAINT IF EXISTS workers_registration_status_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_registration_status_check
  CHECK (registration_status IN ('complete', 'incomplete'));

-- Função de validação de CPF
CREATE OR REPLACE FUNCTION public.is_valid_cpf(_cpf text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v text := regexp_replace(_cpf, '\D', '', 'g');
  d1 int; d2 int; s int; i int;
BEGIN
  IF length(v) <> 11 THEN RETURN false; END IF;
  IF v ~ '^(\d)\1{10}$' THEN RETURN false; END IF;

  s := 0;
  FOR i IN 1..9 LOOP
    s := s + substring(v, i, 1)::int * (11 - i);
  END LOOP;
  d1 := (s * 10) % 11;
  IF d1 = 10 THEN d1 := 0; END IF;
  IF d1 <> substring(v, 10, 1)::int THEN RETURN false; END IF;

  s := 0;
  FOR i IN 1..10 LOOP
    s := s + substring(v, i, 1)::int * (12 - i);
  END LOOP;
  d2 := (s * 10) % 11;
  IF d2 = 10 THEN d2 := 0; END IF;
  IF d2 <> substring(v, 11, 1)::int THEN RETURN false; END IF;

  RETURN true;
END;
$$;

-- Constraint gradual (NOT VALID)
ALTER TABLE public.workers
  DROP CONSTRAINT IF EXISTS workers_valid_cpf_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_valid_cpf_check
  CHECK (cpf_normalized = '' OR public.is_valid_cpf(cpf_normalized))
  NOT VALID;

-- Índices não-únicos, apenas ativos
CREATE INDEX IF NOT EXISTS workers_cpf_normalized_idx
  ON public.workers (cpf_normalized)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS workers_full_name_trgm_idx
  ON public.workers USING gin (lower(full_name) gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS workers_email_lower_idx
  ON public.workers (lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS workers_phone_norm_idx
  ON public.workers ((regexp_replace(coalesce(phone_main, ''), '\D', '', 'g')))
  WHERE deleted_at IS NULL AND phone_main IS NOT NULL;

-- Tabela worker_duplicate_reviews
CREATE TABLE IF NOT EXISTS public.worker_duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_a_id uuid NOT NULL REFERENCES public.workers(id),
  worker_b_id uuid NOT NULL REFERENCES public.workers(id),
  criteria text NOT NULL,
  decision text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_duplicate_reviews_decision_check
    CHECK (decision IN ('pending','kept_separate','false_positive','merged')),
  CONSTRAINT worker_duplicate_reviews_unique
    UNIQUE (worker_a_id, worker_b_id, criteria)
);

GRANT SELECT, INSERT, UPDATE ON public.worker_duplicate_reviews TO authenticated;
GRANT ALL ON public.worker_duplicate_reviews TO service_role;

ALTER TABLE public.worker_duplicate_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wdr_admin_select" ON public.worker_duplicate_reviews;
CREATE POLICY "wdr_admin_select"
  ON public.worker_duplicate_reviews FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "wdr_admin_insert" ON public.worker_duplicate_reviews;
CREATE POLICY "wdr_admin_insert"
  ON public.worker_duplicate_reviews FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "wdr_admin_update" ON public.worker_duplicate_reviews;
CREATE POLICY "wdr_admin_update"
  ON public.worker_duplicate_reviews FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));