-- =========================================================
-- Q-026: HARD DELETE DEFINITIVO DE NR / TREINAMENTO
-- =========================================================

-- 1) Função canônica: hard_delete_sst_chain
CREATE OR REPLACE FUNCTION public.hard_delete_sst_chain(p_qualification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_worker uuid;
  v_document_type_id uuid;
  v_category text;
  v_target public.worker_sst_qualifications%ROWTYPE;
  v_chain_ids uuid[];
  v_chain_paths text[];
  v_wd_ids uuid[];
  v_wd_paths text[];
  v_wdf_paths text[];
  v_trace text := 'hd-' || substr(replace(gen_random_uuid()::text,'-',''),1,10) || '-' || floor(extract(epoch from now())*1000)::text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;

  -- Aceita target ativo, superseded ou já soft-deleted (para limpeza).
  SELECT * INTO v_target
    FROM public.worker_sst_qualifications
   WHERE id = p_qualification_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qualification_not_found' USING ERRCODE='22023';
  END IF;

  v_worker := v_target.worker_id;
  v_document_type_id := v_target.document_type_id;
  IF v_document_type_id IS NULL THEN
    RAISE EXCEPTION 'qualification_missing_document_type' USING ERRCODE='22023';
  END IF;

  -- Lock canônico por (worker, tipo)
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || ':' || v_document_type_id::text, 42)
  );

  SELECT category INTO v_category
    FROM public.document_types WHERE id = v_document_type_id;
  IF v_category NOT IN ('sst_nr','training','safety_training') THEN
    RAISE EXCEPTION 'hard_delete_not_allowed_for_category'
      USING ERRCODE='22023', HINT='hard_delete_sst_chain só pode ser usado para NR ou treinamento.';
  END IF;

  -- Cadeia completa (independente de deleted_at / superseded_at)
  SELECT
    coalesce(array_agg(id), '{}'::uuid[]),
    coalesce(array_agg(document_url) FILTER (WHERE document_url IS NOT NULL AND document_url <> ''), '{}'::text[])
    INTO v_chain_ids, v_chain_paths
    FROM public.worker_sst_qualifications
   WHERE worker_id = v_worker
     AND document_type_id = v_document_type_id;

  -- Legados em worker_documents (mesmo trabalhador + mesmo tipo canônico NR/treinamento)
  SELECT
    coalesce(array_agg(wd.id), '{}'::uuid[]),
    coalesce(array_agg(wd.file_path) FILTER (WHERE wd.file_path IS NOT NULL AND wd.file_path <> ''), '{}'::text[])
    INTO v_wd_ids, v_wd_paths
    FROM public.worker_documents wd
   WHERE wd.worker_id = v_worker
     AND wd.document_type_id = v_document_type_id;

  SELECT coalesce(array_agg(file_path) FILTER (WHERE file_path IS NOT NULL AND file_path <> ''), '{}'::text[])
    INTO v_wdf_paths
    FROM public.worker_document_files
   WHERE worker_document_id = ANY(v_wd_ids);

  -- Auditoria autônoma antes do DELETE (tombstone imutável em change_logs)
  INSERT INTO public.change_logs (table_name, record_id, action, new_data, changed_by)
  VALUES (
    'worker_sst_qualifications',
    p_qualification_id,
    'hard_delete_sst_chain',
    jsonb_build_object(
      'trace_id',            v_trace,
      'worker_id',           v_worker,
      'document_type_id',    v_document_type_id,
      'category',            v_category,
      'nr_code',             v_target.nr_code,
      'target_qualification_id', p_qualification_id,
      'deleted_qualification_ids', to_jsonb(v_chain_ids),
      'deleted_qualification_paths', to_jsonb(v_chain_paths),
      'deleted_worker_document_ids', to_jsonb(v_wd_ids),
      'deleted_worker_document_paths', to_jsonb(v_wd_paths),
      'deleted_worker_document_file_paths', to_jsonb(v_wdf_paths),
      'occurred_at',         now()
    ),
    v_uid
  );

  -- Purga dependências e cadeia SST
  DELETE FROM public.worker_document_revision_events
   WHERE revision_id = ANY(v_chain_ids);

  -- Neutraliza auto-referência supersedes_id antes do DELETE (FK é SET NULL, mas seguimos explícitos)
  UPDATE public.worker_sst_qualifications
     SET supersedes_id = NULL
   WHERE supersedes_id = ANY(v_chain_ids);

  DELETE FROM public.worker_sst_qualifications
   WHERE id = ANY(v_chain_ids);

  -- Purga legados em worker_documents (mesmo worker + tipo)
  IF array_length(v_wd_ids,1) IS NOT NULL THEN
    -- Neutraliza supersedes_id (FK RESTRICT) e refs em outros documentos
    UPDATE public.worker_documents SET supersedes_id = NULL
     WHERE supersedes_id = ANY(v_wd_ids);
    -- worker_document_files: FK CASCADE
    DELETE FROM public.worker_documents WHERE id = ANY(v_wd_ids);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'trace_id', v_trace,
    'worker_id', v_worker,
    'document_type_id', v_document_type_id,
    'category', v_category,
    'deleted_qualification_ids', to_jsonb(v_chain_ids),
    'deleted_worker_document_ids', to_jsonb(v_wd_ids),
    'storage_paths', to_jsonb(
      (SELECT array_agg(DISTINCT p) FROM unnest(v_chain_paths || v_wd_paths || v_wdf_paths) AS p WHERE p IS NOT NULL AND p <> '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_sst_chain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hard_delete_sst_chain(uuid) TO authenticated, service_role;

-- 2) Substitui delete_sst_revision (agora executa hard delete definitivo)
CREATE OR REPLACE FUNCTION public.delete_sst_revision(p_qualification_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.hard_delete_sst_chain(p_qualification_id);
$$;

REVOKE ALL ON FUNCTION public.delete_sst_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sst_revision(uuid) TO authenticated, service_role;

-- 3) MIGRAÇÃO CORRETIVA — purga fantasmas soft-deleted preexistentes.
--    Registra um único change_log por cadeia purgada, sem tocar histórico legítimo (superseded/is_current=false).
DO $$
DECLARE
  r RECORD;
  v_ids uuid[];
  v_paths text[];
  v_wd_ids uuid[];
  v_wd_paths text[];
  v_wdf_paths text[];
BEGIN
  FOR r IN
    SELECT DISTINCT worker_id, document_type_id
      FROM public.worker_sst_qualifications
     WHERE deleted_at IS NOT NULL
       AND document_type_id IS NOT NULL
  LOOP
    -- Só purgamos a CADEIA COMPLETA quando não há mais nenhuma revisão viva (deleted_at IS NULL) desta cadeia.
    -- Caso ainda exista revisão viva (deleted_at IS NULL), removemos APENAS as linhas soft-deleted órfãs.
    IF EXISTS (
      SELECT 1 FROM public.worker_sst_qualifications
       WHERE worker_id = r.worker_id
         AND document_type_id = r.document_type_id
         AND deleted_at IS NULL
    ) THEN
      SELECT array_agg(id),
             coalesce(array_agg(document_url) FILTER (WHERE document_url IS NOT NULL AND document_url<>''), '{}'::text[])
        INTO v_ids, v_paths
        FROM public.worker_sst_qualifications
       WHERE worker_id = r.worker_id
         AND document_type_id = r.document_type_id
         AND deleted_at IS NOT NULL;

      INSERT INTO public.change_logs (table_name, record_id, action, new_data, changed_by)
      VALUES ('worker_sst_qualifications', v_ids[1], 'hard_delete_sst_ghost_migration',
        jsonb_build_object('worker_id', r.worker_id, 'document_type_id', r.document_type_id,
                           'deleted_qualification_ids', to_jsonb(v_ids),
                           'deleted_qualification_paths', to_jsonb(v_paths),
                           'mode', 'orphan_ghosts_only'),
        NULL);

      DELETE FROM public.worker_document_revision_events WHERE revision_id = ANY(v_ids);
      UPDATE public.worker_sst_qualifications SET supersedes_id = NULL WHERE supersedes_id = ANY(v_ids);
      DELETE FROM public.worker_sst_qualifications WHERE id = ANY(v_ids);
    ELSE
      -- Cadeia inteira soft-deleted: purga cadeia + legados worker_documents do mesmo tipo.
      SELECT array_agg(id),
             coalesce(array_agg(document_url) FILTER (WHERE document_url IS NOT NULL AND document_url<>''), '{}'::text[])
        INTO v_ids, v_paths
        FROM public.worker_sst_qualifications
       WHERE worker_id = r.worker_id
         AND document_type_id = r.document_type_id;

      SELECT coalesce(array_agg(id), '{}'::uuid[]),
             coalesce(array_agg(file_path) FILTER (WHERE file_path IS NOT NULL AND file_path<>''), '{}'::text[])
        INTO v_wd_ids, v_wd_paths
        FROM public.worker_documents
       WHERE worker_id = r.worker_id AND document_type_id = r.document_type_id;

      SELECT coalesce(array_agg(file_path) FILTER (WHERE file_path IS NOT NULL AND file_path<>''), '{}'::text[])
        INTO v_wdf_paths
        FROM public.worker_document_files
       WHERE worker_document_id = ANY(v_wd_ids);

      INSERT INTO public.change_logs (table_name, record_id, action, new_data, changed_by)
      VALUES ('worker_sst_qualifications', v_ids[1], 'hard_delete_sst_ghost_migration',
        jsonb_build_object('worker_id', r.worker_id, 'document_type_id', r.document_type_id,
                           'deleted_qualification_ids', to_jsonb(v_ids),
                           'deleted_qualification_paths', to_jsonb(v_paths),
                           'deleted_worker_document_ids', to_jsonb(v_wd_ids),
                           'deleted_worker_document_paths', to_jsonb(v_wd_paths),
                           'deleted_worker_document_file_paths', to_jsonb(v_wdf_paths),
                           'mode', 'full_chain_ghost'),
        NULL);

      DELETE FROM public.worker_document_revision_events WHERE revision_id = ANY(v_ids);
      UPDATE public.worker_sst_qualifications SET supersedes_id = NULL WHERE supersedes_id = ANY(v_ids);
      DELETE FROM public.worker_sst_qualifications WHERE id = ANY(v_ids);

      IF array_length(v_wd_ids,1) IS NOT NULL THEN
        UPDATE public.worker_documents SET supersedes_id = NULL WHERE supersedes_id = ANY(v_wd_ids);
        DELETE FROM public.worker_documents WHERE id = ANY(v_wd_ids);
      END IF;
    END IF;
  END LOOP;
END $$;