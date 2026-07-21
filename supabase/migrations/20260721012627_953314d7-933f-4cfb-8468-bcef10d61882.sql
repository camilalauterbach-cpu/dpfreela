
-- =========================================================================
-- E-SST.1A / Fase 1 — Schema base (sem backfill, sem restrições finais)
-- Idempotente. Nenhum estado intermediário: usa IF NOT EXISTS em tudo.
-- =========================================================================

-- ---------- Enum de motivo de revisão ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sst_revision_reason') THEN
    CREATE TYPE public.sst_revision_reason AS ENUM (
      'created', 'renewed', 'replaced', 'revoked', 'corrected', 'expired', 'migrated'
    );
  END IF;
END $$;

-- ---------- Colunas novas em worker_sst_qualifications ----------
ALTER TABLE public.worker_sst_qualifications
  ADD COLUMN IF NOT EXISTS document_type_id uuid NULL
    REFERENCES public.document_types(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS certificate_file_path       text        NULL,
  ADD COLUMN IF NOT EXISTS certificate_file_name       text        NULL,
  ADD COLUMN IF NOT EXISTS certificate_mime_type       text        NULL,
  ADD COLUMN IF NOT EXISTS certificate_uploaded_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS legacy_worker_document_id            uuid NULL,
  ADD COLUMN IF NOT EXISTS legacy_employment_link_document_id   uuid NULL,
  ADD COLUMN IF NOT EXISTS revision_reason public.sst_revision_reason NULL;

-- ---------- Índices parciais em ativos ----------
-- Observação: o schema atual usa `superseded_at IS NULL` como marcador de vigência
-- (não existe coluna `is_current`).
CREATE INDEX IF NOT EXISTS idx_sst_qual_worker_type_current
  ON public.worker_sst_qualifications (worker_id, document_type_id)
  WHERE deleted_at IS NULL AND superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sst_qual_worker_type_issued_active
  ON public.worker_sst_qualifications (worker_id, document_type_id, issued_at)
  WHERE deleted_at IS NULL AND document_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sst_qual_expires_at
  ON public.worker_sst_qualifications (expires_at)
  WHERE deleted_at IS NULL AND superseded_at IS NULL;

-- ---------- Trigger: document_type_id só aceita categoria sst_nr ----------
CREATE OR REPLACE FUNCTION public.validate_sst_qual_document_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat text;
BEGIN
  IF NEW.document_type_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT category INTO v_cat
    FROM public.document_types
   WHERE id = NEW.document_type_id;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'invalid_document_type' USING ERRCODE = '22023';
  END IF;
  IF v_cat <> 'sst_nr' THEN
    RAISE EXCEPTION 'document_type_not_sst_nr' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sst_qual_document_type ON public.worker_sst_qualifications;
CREATE TRIGGER trg_validate_sst_qual_document_type
  AFTER INSERT OR UPDATE OF document_type_id
  ON public.worker_sst_qualifications
  FOR EACH ROW
  WHEN (NEW.document_type_id IS NOT NULL)
  EXECUTE FUNCTION public.validate_sst_qual_document_type();

-- ---------- Trigger de bloqueio de NRs em worker_documents ----------
-- Criada agora, ANEXADA apenas na Fase 3. Aceita bypass via GUC de sessão.
CREATE OR REPLACE FUNCTION public.worker_documents_block_sst_nr()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat text;
  v_bypass text;
BEGIN
  IF NEW.document_type_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_bypass := current_setting('app.allow_legacy_sst_write', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'true' THEN
    RETURN NEW;
  END IF;
  SELECT category INTO v_cat
    FROM public.document_types
   WHERE id = NEW.document_type_id;
  IF v_cat = 'sst_nr' THEN
    RAISE EXCEPTION 'sst_nr_must_use_worker_sst_qualifications'
      USING ERRCODE = '42501',
            HINT = 'NRs (categoria sst_nr) só podem ser gravadas via worker_sst_qualifications';
  END IF;
  RETURN NEW;
END;
$$;

-- (não anexa o trigger nesta fase)

-- ---------- Recriar as views para expor revision_reason ----------
DROP VIEW IF EXISTS public.worker_sst_qualifications_current;
DROP VIEW IF EXISTS public.worker_sst_qualifications_history;

CREATE VIEW public.worker_sst_qualifications_history AS
SELECT
  id, worker_id, nr_code, chain_key, training_type, issued_at, expires_at,
  workload_hours, provider_name, instructor_name, document_url, document_status,
  validity_status, source_type, revision_type, revision_reason, document_type_id,
  employment_link_document_id, link_group_worker_id, link_group_id, event_id, company_id,
  supersedes_id, superseded_at, notes, created_at, updated_at, deleted_at,
  CASE
    WHEN validity_status = 'no_expiry' THEN 'no_expiry'
    WHEN validity_status = 'unknown'   THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at IS NULL THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at < CURRENT_DATE THEN 'expired'
    WHEN validity_status = 'has_expiry' AND expires_at <= (CURRENT_DATE + '30 days'::interval) THEN 'expiring_soon'
    WHEN validity_status = 'has_expiry' THEN 'valid'
    ELSE 'unknown'
  END AS expiration_status
FROM public.worker_sst_qualifications q
WHERE deleted_at IS NULL
ORDER BY worker_id, nr_code, issued_at DESC, created_at DESC;

CREATE VIEW public.worker_sst_qualifications_current AS
SELECT DISTINCT ON (worker_id, chain_key)
  id, worker_id, nr_code, chain_key, training_type, issued_at, expires_at,
  workload_hours, provider_name, instructor_name, document_url, document_status,
  validity_status, source_type, revision_type, revision_reason, document_type_id,
  employment_link_document_id, link_group_worker_id, link_group_id, event_id, company_id,
  notes, created_at, updated_at,
  CASE
    WHEN validity_status = 'no_expiry' THEN 'no_expiry'
    WHEN validity_status = 'unknown'   THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at IS NULL THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at < CURRENT_DATE THEN 'expired'
    WHEN validity_status = 'has_expiry' AND expires_at <= (CURRENT_DATE + '30 days'::interval) THEN 'expiring_soon'
    WHEN validity_status = 'has_expiry' THEN 'valid'
    ELSE 'unknown'
  END AS expiration_status
FROM public.worker_sst_qualifications
WHERE deleted_at IS NULL AND superseded_at IS NULL
ORDER BY worker_id, chain_key, issued_at DESC, created_at DESC;

GRANT SELECT ON public.worker_sst_qualifications_current TO authenticated;
GRANT SELECT ON public.worker_sst_qualifications_history TO authenticated;
GRANT ALL    ON public.worker_sst_qualifications_current TO service_role;
GRANT ALL    ON public.worker_sst_qualifications_history TO service_role;

-- =========================================================================
-- Infra transversal — auditoria de migração
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.migration_execution_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name text        NOT NULL,
  phase          text        NOT NULL,
  executed_at    timestamptz NOT NULL DEFAULT now(),
  success        boolean     NOT NULL,
  environment    text        NULL,
  git_revision   text        NULL,
  executed_by    text        NULL,
  notes          text        NULL
);
CREATE INDEX IF NOT EXISTS idx_mig_exec_log_name_phase
  ON public.migration_execution_log(migration_name, phase, executed_at DESC);

GRANT SELECT ON public.migration_execution_log TO authenticated;
GRANT ALL    ON public.migration_execution_log TO service_role;
ALTER TABLE public.migration_execution_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mig_log_select_admin_manager" ON public.migration_execution_log;
CREATE POLICY "mig_log_select_admin_manager" ON public.migration_execution_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role,'manager'::public.app_role]));

CREATE TABLE IF NOT EXISTS public.sst_migration_audit (
  id                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name                        text NOT NULL,
  started_at                            timestamptz NOT NULL,
  finished_at                           timestamptz NULL,
  success                               boolean     NULL,
  worker_documents_migrated             integer     NOT NULL DEFAULT 0,
  employment_link_documents_migrated    integer     NOT NULL DEFAULT 0,
  history_updated                       integer     NOT NULL DEFAULT 0,
  unmatched                             integer     NOT NULL DEFAULT 0,
  duration_ms                           integer     NULL
);
CREATE INDEX IF NOT EXISTS idx_sst_migration_audit_name
  ON public.sst_migration_audit(migration_name, started_at DESC);

GRANT SELECT ON public.sst_migration_audit TO authenticated;
GRANT ALL    ON public.sst_migration_audit TO service_role;
ALTER TABLE public.sst_migration_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sst_mig_audit_select_admin_manager" ON public.sst_migration_audit;
CREATE POLICY "sst_mig_audit_select_admin_manager" ON public.sst_migration_audit
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role,'manager'::public.app_role]));

CREATE TABLE IF NOT EXISTS public.sst_migration_unmatched (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  text NOT NULL,
  source_id     uuid NULL,
  worker_id     uuid NULL,
  nr_code       text NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sst_migration_unmatched_created
  ON public.sst_migration_unmatched(created_at DESC);

GRANT SELECT ON public.sst_migration_unmatched TO authenticated;
GRANT ALL    ON public.sst_migration_unmatched TO service_role;
ALTER TABLE public.sst_migration_unmatched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sst_mig_unmatched_select_admin_manager" ON public.sst_migration_unmatched;
CREATE POLICY "sst_mig_unmatched_select_admin_manager" ON public.sst_migration_unmatched
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role,'manager'::public.app_role]));

-- =========================================================================
-- Fim da Fase 1
-- =========================================================================
INSERT INTO public.migration_execution_log(migration_name, phase, success, environment, git_revision, executed_by, notes)
VALUES (
  'E-SST.1A',
  'Phase 1',
  true,
  current_setting('app.deploy_environment', true),
  current_setting('app.git_revision', true),
  coalesce(auth.uid()::text, current_user),
  'schema: colunas, índices parciais, triggers, views, tabelas de auditoria'
);
