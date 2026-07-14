-- =============================================================
-- Entrega 3 — Controle SST: fundação de dados e leitura
-- Cria tabela worker_sst_qualifications, triggers de validação
-- e encadeamento, views histórica e atual (security_invoker), RLS.
-- =============================================================

-- ---------- Tabela ----------
CREATE TABLE public.worker_sst_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE RESTRICT,
  nr_code text NOT NULL,
  training_type text,
  issued_at date NOT NULL,
  expires_at date,
  workload_hours numeric(6,2),
  provider_name text,
  provider_document text,
  instructor_name text,
  document_url text,
  document_status text NOT NULL DEFAULT 'pending'
    CHECK (document_status IN ('pending','ok','rejected')),
  notes text,
  supersedes_id uuid REFERENCES public.worker_sst_qualifications(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.worker_sst_qualifications IS
  'Registros de qualificações SST (NRs) por trabalhador. Cada linha é um treinamento; a view _current retorna a linha vigente por (worker_id, nr_code).';

CREATE INDEX idx_sst_worker           ON public.worker_sst_qualifications(worker_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sst_worker_nr        ON public.worker_sst_qualifications(worker_id, nr_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_sst_expires_at       ON public.worker_sst_qualifications(expires_at)  WHERE deleted_at IS NULL AND superseded_at IS NULL;
CREATE INDEX idx_sst_nr_code          ON public.worker_sst_qualifications(nr_code)     WHERE deleted_at IS NULL;

-- ---------- GRANTS ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_sst_qualifications TO authenticated;
GRANT ALL ON public.worker_sst_qualifications TO service_role;

-- ---------- Triggers ----------
CREATE OR REPLACE FUNCTION public.validate_sst_qualification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.issued_at IS NULL THEN
    RAISE EXCEPTION 'issued_at obrigatório' USING ERRCODE = '22023';
  END IF;
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.issued_at THEN
    RAISE EXCEPTION 'expires_at deve ser posterior a issued_at' USING ERRCODE = '22023';
  END IF;
  IF NEW.nr_code IS NULL OR btrim(NEW.nr_code) = '' THEN
    RAISE EXCEPTION 'nr_code obrigatório' USING ERRCODE = '22023';
  END IF;
  NEW.nr_code := upper(btrim(NEW.nr_code));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_sst_qualification
BEFORE INSERT OR UPDATE ON public.worker_sst_qualifications
FOR EACH ROW EXECUTE FUNCTION public.validate_sst_qualification();

CREATE TRIGGER trg_sst_qualifications_updated_at
BEFORE UPDATE ON public.worker_sst_qualifications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Encadeamento: ao inserir/atualizar uma linha vigente,
-- marcar como superseded_at as demais linhas anteriores do mesmo (worker, NR)
-- cuja issued_at seja menor ou igual à da nova linha.
CREATE OR REPLACE FUNCTION public.chain_sst_qualifications()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.worker_sst_qualifications
     SET superseded_at = now(),
         supersedes_id = COALESCE(supersedes_id, NEW.id)
   WHERE worker_id = NEW.worker_id
     AND nr_code   = NEW.nr_code
     AND id       <> NEW.id
     AND deleted_at IS NULL
     AND superseded_at IS NULL
     AND issued_at   <= NEW.issued_at;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chain_sst_qualifications
AFTER INSERT OR UPDATE OF issued_at, expires_at, deleted_at
ON public.worker_sst_qualifications
FOR EACH ROW EXECUTE FUNCTION public.chain_sst_qualifications();

-- ---------- RLS ----------
ALTER TABLE public.worker_sst_qualifications ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer papel autenticado do sistema (inclui viewer)
CREATE POLICY "sst_select_all_roles"
ON public.worker_sst_qualifications
FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[])
);

-- Escrita: admin, manager, operator
CREATE POLICY "sst_insert_write_roles"
ON public.worker_sst_qualifications
FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[])
);

CREATE POLICY "sst_update_write_roles"
ON public.worker_sst_qualifications
FOR UPDATE TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[])
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::app_role[])
);

CREATE POLICY "sst_delete_admin_manager"
ON public.worker_sst_qualifications
FOR DELETE TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[])
);

-- ---------- Views (security_invoker = true) ----------
-- Histórica: tudo, com status derivado
CREATE OR REPLACE VIEW public.worker_sst_qualifications_history
WITH (security_invoker = true) AS
SELECT
  q.id,
  q.worker_id,
  q.nr_code,
  q.training_type,
  q.issued_at,
  q.expires_at,
  q.workload_hours,
  q.provider_name,
  q.instructor_name,
  q.document_url,
  q.document_status,
  q.notes,
  q.supersedes_id,
  q.superseded_at,
  q.created_at,
  q.updated_at,
  q.deleted_at,
  CASE
    WHEN q.expires_at IS NULL                            THEN 'no_expiry'
    WHEN q.expires_at < CURRENT_DATE                     THEN 'expired'
    WHEN q.expires_at <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'valid'
  END AS expiration_status
FROM public.worker_sst_qualifications q;

-- Atual: linha vigente por (worker_id, nr_code) — a mais recente não superseded/deleted
CREATE OR REPLACE VIEW public.worker_sst_qualifications_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (q.worker_id, q.nr_code)
  q.id,
  q.worker_id,
  q.nr_code,
  q.training_type,
  q.issued_at,
  q.expires_at,
  q.workload_hours,
  q.provider_name,
  q.instructor_name,
  q.document_url,
  q.document_status,
  q.notes,
  q.created_at,
  q.updated_at,
  CASE
    WHEN q.expires_at IS NULL                            THEN 'no_expiry'
    WHEN q.expires_at < CURRENT_DATE                     THEN 'expired'
    WHEN q.expires_at <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'valid'
  END AS expiration_status
FROM public.worker_sst_qualifications q
WHERE q.deleted_at IS NULL
  AND q.superseded_at IS NULL
ORDER BY q.worker_id, q.nr_code, q.issued_at DESC, q.created_at DESC;

GRANT SELECT ON public.worker_sst_qualifications_history TO authenticated;
GRANT SELECT ON public.worker_sst_qualifications_current TO authenticated;
