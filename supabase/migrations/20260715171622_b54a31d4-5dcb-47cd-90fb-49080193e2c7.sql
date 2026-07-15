
-- Redefine constraint para escopo de dados ativos (soft-delete-aware)
ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_valid_cpf_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_valid_cpf_check
  CHECK (
    deleted_at IS NOT NULL
    OR cpf_normalized IS NULL
    OR cpf_normalized = ''
    OR public.is_valid_cpf(cpf_normalized)
  ) NOT VALID;

ALTER TABLE public.workers VALIDATE CONSTRAINT workers_valid_cpf_check;

CREATE UNIQUE INDEX IF NOT EXISTS workers_unique_active_cpf
  ON public.workers (cpf_normalized)
  WHERE deleted_at IS NULL
    AND cpf_normalized IS NOT NULL
    AND cpf_normalized <> ''
    AND length(cpf_normalized) = 11;

CREATE UNIQUE INDEX IF NOT EXISTS workers_unique_active_linked_profile
  ON public.workers (linked_profile_id)
  WHERE deleted_at IS NULL
    AND linked_profile_id IS NOT NULL;
