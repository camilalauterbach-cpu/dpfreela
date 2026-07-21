
-- =========================================================================
-- E-SST.1A / Fase 3 — Restrições finais (schema-only, sem tocar em motor)
-- =========================================================================

-- ---------- 1) Reforçar o gatilho de bloqueio ----------
-- Cobre dois caminhos: document_type_id apontando para sst_nr OU category
-- textual no padrão nr_* (defesa contra o legado). Bypass mantido via GUC.
CREATE OR REPLACE FUNCTION public.worker_documents_block_sst_nr()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat text;
  v_bypass text;
BEGIN
  BEGIN
    v_bypass := current_setting('app.allow_legacy_sst_write', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'true' THEN
    RETURN NEW;
  END IF;

  -- Caminho A: referência canônica ao catálogo
  IF NEW.document_type_id IS NOT NULL THEN
    SELECT category INTO v_cat
      FROM public.document_types
     WHERE id = NEW.document_type_id;
    IF v_cat = 'sst_nr' THEN
      RAISE EXCEPTION 'sst_nr_must_use_worker_sst_qualifications'
        USING ERRCODE = '42501',
              HINT = 'NRs (categoria sst_nr) só podem ser gravadas via worker_sst_qualifications';
    END IF;
  END IF;

  -- Caminho B: texto legado (category ou document_type) no padrão NR
  IF NEW.category IS NOT NULL
     AND public.f_normalize_nr_code(NEW.category) IS NOT NULL THEN
    RAISE EXCEPTION 'sst_nr_must_use_worker_sst_qualifications'
      USING ERRCODE = '42501',
            HINT  = 'Categoria textual de NR detectada; use worker_sst_qualifications';
  END IF;
  IF NEW.document_type IS NOT NULL
     AND public.f_normalize_nr_code(NEW.document_type) IS NOT NULL THEN
    RAISE EXCEPTION 'sst_nr_must_use_worker_sst_qualifications'
      USING ERRCODE = '42501',
            HINT  = 'document_type textual de NR detectado; use worker_sst_qualifications';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------- 2) ANEXAR o trigger em worker_documents ----------
DROP TRIGGER IF EXISTS trg_worker_documents_block_sst_nr ON public.worker_documents;
CREATE TRIGGER trg_worker_documents_block_sst_nr
  BEFORE INSERT OR UPDATE OF document_type_id, category, document_type
  ON public.worker_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.worker_documents_block_sst_nr();

-- ---------- 3) Pré-check: nenhuma qualificação ativa sem document_type_id ----------
DO $chk$
DECLARE v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing
    FROM public.worker_sst_qualifications
   WHERE deleted_at IS NULL AND document_type_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'phase3_abort: % active qualifications still have document_type_id NULL', v_missing
      USING ERRCODE = 'P0001';
  END IF;
END;
$chk$;

-- ---------- 4) Promover document_type_id a NOT NULL ----------
-- Observação: registros soft-deleted com document_type_id NULL não bloqueiam
-- porque o filtro é aplicado apenas em ativos pelo pré-check; a coluna passa
-- a ser NOT NULL para todos os registros, então garantimos que soft-deletes
-- históricos também tenham valor: se algum tiver NULL, o ALTER falha e a
-- migration aborta (comportamento desejado — nada oculto).
ALTER TABLE public.worker_sst_qualifications
  ALTER COLUMN document_type_id SET NOT NULL;

-- ---------- 5) Invariantes finais ----------
DO $inv$
DECLARE
  v_active_null     integer;
  v_wd_sst_nr       integer;
  v_dups            integer;
BEGIN
  SELECT count(*) INTO v_active_null
    FROM public.worker_sst_qualifications
   WHERE deleted_at IS NULL AND document_type_id IS NULL;

  SELECT count(*) INTO v_wd_sst_nr
    FROM public.worker_documents wd
    LEFT JOIN public.document_types dt ON dt.id = wd.document_type_id
   WHERE wd.deleted_at IS NULL
     AND (
       dt.category = 'sst_nr'
       OR public.f_normalize_nr_code(wd.category)      IS NOT NULL
       OR public.f_normalize_nr_code(wd.document_type) IS NOT NULL
     );

  SELECT count(*) INTO v_dups
    FROM (
      SELECT worker_id, document_type_id
        FROM public.worker_sst_qualifications
       WHERE deleted_at IS NULL AND superseded_at IS NULL
       GROUP BY 1,2
      HAVING count(*) > 1
    ) t;

  IF v_active_null <> 0 OR v_dups <> 0 THEN
    RAISE EXCEPTION 'phase3_abort: invariantes falharam — active_null=%, wd_sst_nr(pre)=%, dups=%',
      v_active_null, v_wd_sst_nr, v_dups
      USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'E-SST.1A/Fase3 invariantes OK — active_null=%, wd_sst_nr(legado)=%, dups_ativas=%',
    v_active_null, v_wd_sst_nr, v_dups;
END;
$inv$;

-- ---------- 6) Encerramento da E-SST.1A ----------
INSERT INTO public.migration_execution_log(migration_name, phase, success, environment, git_revision, executed_by, notes)
VALUES (
  'E-SST.1A',
  'Phase 3',
  true,
  current_setting('app.deploy_environment', true),
  current_setting('app.git_revision', true),
  coalesce(auth.uid()::text, current_user),
  'restrições finais: trigger anexado, document_type_id NOT NULL, invariantes validadas'
);

INSERT INTO public.migration_execution_log(migration_name, phase, success, environment, git_revision, executed_by, notes)
VALUES (
  'E-SST.1A',
  'Complete',
  true,
  current_setting('app.deploy_environment', true),
  current_setting('app.git_revision', true),
  coalesce(auth.uid()::text, current_user),
  'E-SST.1A concluída — schema consolidado; motor de conformidade permanece intocado (E-SST.1B)'
);
