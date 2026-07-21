
-- =========================================================================
-- E-SST.1A / Fase 2 — Backfill do legado (transacional, abortável)
-- =========================================================================

-- ---------- 1) Função interna determinística de normalização ----------
CREATE OR REPLACE FUNCTION public.f_normalize_nr_code(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean text;
  v_num   text;
BEGIN
  IF _raw IS NULL THEN RETURN NULL; END IF;
  v_clean := upper(regexp_replace(btrim(_raw), '\s+', '', 'g'));
  v_num   := (regexp_match(v_clean, '^NR[-_ ]?([0-9]+)$'))[1];
  IF v_num IS NULL THEN RETURN NULL; END IF;
  RETURN 'NR' || lpad(v_num, 2, '0');
END;
$$;

COMMENT ON FUNCTION public.f_normalize_nr_code(text) IS
  'Uso exclusivo de migração legada (E-SST.1A). Fora dela, use document_type_id como referência oficial.';

-- ---------- 2) Bloco transacional de backfill com auditoria ----------
DO $mig$
DECLARE
  v_audit_id      uuid;
  v_started_at    timestamptz := clock_timestamp();
  v_updated       integer := 0;
  v_created_eld   integer := 0;
  v_created_wd    integer := 0;
  v_unmatched     integer := 0;
  v_skipped_dup   integer := 0;
  v_migration     text := 'E-SST.1A-Phase2';
BEGIN
  -- Início da auditoria
  INSERT INTO public.sst_migration_audit(migration_name, started_at)
  VALUES (v_migration, v_started_at)
  RETURNING id INTO v_audit_id;

  ---------------------------------------------------------------------
  -- (A) Registrar unmatched — qualificações cujo nr_code não normaliza
  ---------------------------------------------------------------------
  INSERT INTO public.sst_migration_unmatched(source_table, source_id, worker_id, nr_code, reason)
  SELECT 'worker_sst_qualifications', q.id, q.worker_id, q.nr_code,
         'nr_code_does_not_match_pattern'
    FROM public.worker_sst_qualifications q
   WHERE q.deleted_at IS NULL
     AND q.document_type_id IS NULL
     AND public.f_normalize_nr_code(q.nr_code) IS NULL;

  ---------------------------------------------------------------------
  -- (B) Registrar unmatched — link_documents cuja category não normaliza
  ---------------------------------------------------------------------
  INSERT INTO public.sst_migration_unmatched(source_table, source_id, worker_id, nr_code, reason)
  SELECT 'employment_link_documents', eld.id, eld.worker_id, eld.category,
         'category_does_not_match_pattern'
    FROM public.employment_link_documents eld
    LEFT JOIN public.worker_sst_qualifications q
           ON q.employment_link_document_id = eld.id AND q.deleted_at IS NULL
   WHERE eld.deleted_at IS NULL
     AND q.id IS NULL
     AND eld.category ~* '^nr'
     AND public.f_normalize_nr_code(eld.category) IS NULL;

  ---------------------------------------------------------------------
  -- (C) Registrar unmatched — códigos que normalizam MAS não estão no catálogo
  ---------------------------------------------------------------------
  INSERT INTO public.sst_migration_unmatched(source_table, source_id, worker_id, nr_code, reason)
  SELECT 'worker_sst_qualifications', q.id, q.worker_id, q.nr_code,
         'normalized_code_not_in_catalog:' || public.f_normalize_nr_code(q.nr_code)
    FROM public.worker_sst_qualifications q
   WHERE q.deleted_at IS NULL
     AND q.document_type_id IS NULL
     AND public.f_normalize_nr_code(q.nr_code) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.document_types dt
        WHERE dt.code = public.f_normalize_nr_code(q.nr_code)
          AND dt.category = 'sst_nr'
     );

  INSERT INTO public.sst_migration_unmatched(source_table, source_id, worker_id, nr_code, reason)
  SELECT 'employment_link_documents', eld.id, eld.worker_id, eld.category,
         'normalized_code_not_in_catalog:' || public.f_normalize_nr_code(eld.category)
    FROM public.employment_link_documents eld
    LEFT JOIN public.worker_sst_qualifications q
           ON q.employment_link_document_id = eld.id AND q.deleted_at IS NULL
   WHERE eld.deleted_at IS NULL
     AND q.id IS NULL
     AND public.f_normalize_nr_code(eld.category) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.document_types dt
        WHERE dt.code = public.f_normalize_nr_code(eld.category)
          AND dt.category = 'sst_nr'
     );

  ---------------------------------------------------------------------
  -- (D) Gate: aborta se houver algum unmatched neste run
  ---------------------------------------------------------------------
  SELECT count(*) INTO v_unmatched
    FROM public.sst_migration_unmatched
   WHERE created_at >= v_started_at;

  IF v_unmatched > 0 THEN
    UPDATE public.sst_migration_audit
       SET finished_at = clock_timestamp(),
           success = false,
           unmatched = v_unmatched,
           duration_ms = extract(millisecond from clock_timestamp() - v_started_at)::int
     WHERE id = v_audit_id;
    RAISE EXCEPTION 'sst_migration_aborted: % unmatched items (see sst_migration_unmatched)', v_unmatched
      USING ERRCODE = 'P0001';
  END IF;

  ---------------------------------------------------------------------
  -- (E) UPDATE das 43 qualificações existentes: vincular document_type_id
  ---------------------------------------------------------------------
  WITH upd AS (
    UPDATE public.worker_sst_qualifications q
       SET document_type_id = dt.id,
           updated_at = now()
      FROM public.document_types dt
     WHERE q.deleted_at IS NULL
       AND q.document_type_id IS NULL
       AND dt.category = 'sst_nr'
       AND dt.code = public.f_normalize_nr_code(q.nr_code)
    RETURNING q.id
  )
  SELECT count(*) INTO v_updated FROM upd;

  ---------------------------------------------------------------------
  -- (F) INSERT das qualificações órfãs a partir de employment_link_documents
  --     Regra de duplicidade: pular se já existir qualquer qualificação ATIVA
  --     para (worker_id, document_type_id) — segue a política canônica de
  --     reaproveitamento (R3) da E-SST.
  ---------------------------------------------------------------------
  WITH candidates AS (
    SELECT
      eld.id                     AS eld_id,
      eld.worker_id              AS worker_id,
      dt.id                      AS document_type_id,
      dt.code                    AS canonical_code,
      eld.file_path              AS certificate_file_path,
      eld.file_name              AS certificate_file_name,
      eld.mime_type              AS certificate_mime_type,
      eld.created_at             AS eld_created_at,
      eld.notes                  AS eld_notes,
      eld.category               AS raw_category
    FROM public.employment_link_documents eld
    LEFT JOIN public.worker_sst_qualifications q
           ON q.employment_link_document_id = eld.id AND q.deleted_at IS NULL
    JOIN public.document_types dt
           ON dt.category = 'sst_nr'
          AND dt.code = public.f_normalize_nr_code(eld.category)
   WHERE eld.deleted_at IS NULL
     AND q.id IS NULL
  ),
  dedup AS (
    -- descarta se já houver qualificação ATIVA para (worker_id, document_type_id)
    SELECT c.*
      FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.worker_sst_qualifications q2
        WHERE q2.deleted_at IS NULL
          AND q2.worker_id = c.worker_id
          AND q2.document_type_id = c.document_type_id
     )
  ),
  ins AS (
    INSERT INTO public.worker_sst_qualifications (
      worker_id, nr_code, document_type_id,
      issued_at, validity_status,
      source_type, revision_type, revision_reason,
      document_status, document_url,
      certificate_file_path, certificate_file_name, certificate_mime_type,
      certificate_uploaded_at,
      employment_link_document_id, legacy_employment_link_document_id,
      notes
    )
    SELECT
      d.worker_id,
      d.canonical_code,                                 -- nr_code canônico
      d.document_type_id,
      d.eld_created_at::date,                           -- issued_at inferido (fallback técnico)
      'unknown',                                        -- validity_status
      'link_document',                                  -- source_type
      'initial',                                        -- revision_type
      'migrated',                                       -- revision_reason
      CASE WHEN d.certificate_file_path IS NOT NULL THEN 'pending' ELSE 'no_document' END,
      d.certificate_file_path,
      d.certificate_file_path, d.certificate_file_name, d.certificate_mime_type,
      CASE WHEN d.certificate_file_path IS NOT NULL THEN d.eld_created_at ELSE NULL END,
      d.eld_id, d.eld_id,
      coalesce(d.eld_notes || E'\n', '')
        || '[E-SST.1A migração] issued_at inferido de employment_link_documents.created_at ('
        || d.eld_created_at::date || '). Categoria original: ' || d.raw_category
    FROM dedup d
    RETURNING id
  )
  SELECT count(*) INTO v_created_eld FROM ins;

  -- Contagem de duplicados descartados (para relatório)
  SELECT count(*) INTO v_skipped_dup
    FROM public.employment_link_documents eld
    LEFT JOIN public.worker_sst_qualifications q
           ON q.employment_link_document_id = eld.id AND q.deleted_at IS NULL
    JOIN public.document_types dt
           ON dt.category = 'sst_nr' AND dt.code = public.f_normalize_nr_code(eld.category)
   WHERE eld.deleted_at IS NULL
     AND q.id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.worker_sst_qualifications q2
        WHERE q2.deleted_at IS NULL
          AND q2.worker_id = eld.worker_id
          AND q2.document_type_id = dt.id
     );

  ---------------------------------------------------------------------
  -- (G) worker_documents — 0 linhas hoje (verificado). Estrutura mantida
  --     para futura reexecução idempotente.
  ---------------------------------------------------------------------
  v_created_wd := 0;

  ---------------------------------------------------------------------
  -- (H) Validação final: nenhuma qualificação ativa deve ter document_type_id NULL
  ---------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.worker_sst_qualifications
     WHERE deleted_at IS NULL AND document_type_id IS NULL
  ) THEN
    UPDATE public.sst_migration_audit
       SET finished_at = clock_timestamp(),
           success = false,
           worker_documents_migrated = v_created_wd,
           employment_link_documents_migrated = v_created_eld,
           history_updated = v_updated,
           unmatched = v_unmatched,
           duration_ms = extract(millisecond from clock_timestamp() - v_started_at)::int
     WHERE id = v_audit_id;
    RAISE EXCEPTION 'sst_migration_aborted: active qualifications remain without document_type_id'
      USING ERRCODE = 'P0001';
  END IF;

  ---------------------------------------------------------------------
  -- (I) Auditoria fechada
  ---------------------------------------------------------------------
  UPDATE public.sst_migration_audit
     SET finished_at = clock_timestamp(),
         success = true,
         worker_documents_migrated = v_created_wd,
         employment_link_documents_migrated = v_created_eld,
         history_updated = v_updated,
         unmatched = 0,
         duration_ms = extract(millisecond from clock_timestamp() - v_started_at)::int
   WHERE id = v_audit_id;

  RAISE NOTICE 'E-SST.1A/Fase2 OK — updated=%, created_eld=%, created_wd=%, unmatched=%, skipped_dup=%',
    v_updated, v_created_eld, v_created_wd, 0, v_skipped_dup;
END;
$mig$;

-- ---------- 3) Registrar conclusão da Fase 2 no log de execução ----------
INSERT INTO public.migration_execution_log(migration_name, phase, success, environment, git_revision, executed_by, notes)
VALUES (
  'E-SST.1A',
  'Phase 2',
  true,
  current_setting('app.deploy_environment', true),
  current_setting('app.git_revision', true),
  coalesce(auth.uid()::text, current_user),
  'backfill: f_normalize_nr_code + UPDATE 43 + INSERT órfãos (link_documents)'
);
