
-- 1) Tabela de jobs de limpeza de Storage
CREATE TABLE IF NOT EXISTS public.worker_document_storage_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  path text NOT NULL,
  worker_id uuid,
  document_type_id uuid,
  trace_id text,
  source text NOT NULL DEFAULT 'hard_delete_sst_chain',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT worker_document_storage_cleanup_jobs_status_chk
    CHECK (status IN ('pending','completed','failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_document_storage_cleanup_jobs_unique_active
  ON public.worker_document_storage_cleanup_jobs (bucket, path)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS worker_document_storage_cleanup_jobs_status_idx
  ON public.worker_document_storage_cleanup_jobs (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.worker_document_storage_cleanup_jobs TO authenticated;
GRANT ALL ON public.worker_document_storage_cleanup_jobs TO service_role;

ALTER TABLE public.worker_document_storage_cleanup_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_document_storage_cleanup_jobs_select ON public.worker_document_storage_cleanup_jobs;
CREATE POLICY worker_document_storage_cleanup_jobs_select
  ON public.worker_document_storage_cleanup_jobs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.has_role(auth.uid(),'manager'::public.app_role)
    OR public.has_role(auth.uid(),'operator'::public.app_role)
  );

DROP POLICY IF EXISTS worker_document_storage_cleanup_jobs_update ON public.worker_document_storage_cleanup_jobs;
CREATE POLICY worker_document_storage_cleanup_jobs_update
  ON public.worker_document_storage_cleanup_jobs
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.has_role(auth.uid(),'manager'::public.app_role)
    OR public.has_role(auth.uid(),'operator'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.has_role(auth.uid(),'manager'::public.app_role)
    OR public.has_role(auth.uid(),'operator'::public.app_role)
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.tg_worker_document_storage_cleanup_jobs_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_worker_document_storage_cleanup_jobs_touch ON public.worker_document_storage_cleanup_jobs;
CREATE TRIGGER trg_worker_document_storage_cleanup_jobs_touch
  BEFORE UPDATE ON public.worker_document_storage_cleanup_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_worker_document_storage_cleanup_jobs_touch();

-- 2) hard_delete_sst_chain: enfileira paths antes de retornar
CREATE OR REPLACE FUNCTION public.hard_delete_sst_chain(p_qualification_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_all_paths text[];
  v_job_ids uuid[] := '{}'::uuid[];
  v_new_job uuid;
  v_path text;
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || ':' || v_document_type_id::text, 42)
  );

  SELECT category INTO v_category
    FROM public.document_types WHERE id = v_document_type_id;
  IF v_category NOT IN ('sst_nr','training','safety_training') THEN
    RAISE EXCEPTION 'hard_delete_not_allowed_for_category'
      USING ERRCODE='22023', HINT='hard_delete_sst_chain só pode ser usado para NR ou treinamento.';
  END IF;

  SELECT
    coalesce(array_agg(id), '{}'::uuid[]),
    coalesce(array_agg(document_url) FILTER (WHERE document_url IS NOT NULL AND document_url <> ''), '{}'::text[])
    INTO v_chain_ids, v_chain_paths
    FROM public.worker_sst_qualifications
   WHERE worker_id = v_worker
     AND document_type_id = v_document_type_id;

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

  DELETE FROM public.worker_document_revision_events
   WHERE revision_id = ANY(v_chain_ids);

  UPDATE public.worker_sst_qualifications
     SET supersedes_id = NULL
   WHERE supersedes_id = ANY(v_chain_ids);

  DELETE FROM public.worker_sst_qualifications
   WHERE id = ANY(v_chain_ids);

  IF array_length(v_wd_ids,1) IS NOT NULL THEN
    UPDATE public.worker_documents SET supersedes_id = NULL
     WHERE supersedes_id = ANY(v_wd_ids);
    DELETE FROM public.worker_documents WHERE id = ANY(v_wd_ids);
  END IF;

  -- Enfileira jobs de limpeza de Storage (dedup + já-completos são ignorados)
  SELECT coalesce(array_agg(DISTINCT p), '{}'::text[])
    INTO v_all_paths
    FROM unnest(v_chain_paths || v_wd_paths || v_wdf_paths) AS p
   WHERE p IS NOT NULL AND p <> '';

  FOREACH v_path IN ARRAY v_all_paths LOOP
    INSERT INTO public.worker_document_storage_cleanup_jobs
      (bucket, path, worker_id, document_type_id, trace_id, source, status)
    VALUES
      ('worker-documents', v_path, v_worker, v_document_type_id, v_trace, 'hard_delete_sst_chain', 'pending')
    ON CONFLICT (bucket, path) WHERE status <> 'completed' DO UPDATE
      SET status = 'pending',
          last_error = NULL,
          trace_id = EXCLUDED.trace_id,
          worker_id = EXCLUDED.worker_id,
          document_type_id = EXCLUDED.document_type_id,
          updated_at = now()
    RETURNING id INTO v_new_job;
    IF v_new_job IS NOT NULL THEN
      v_job_ids := v_job_ids || v_new_job;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'trace_id', v_trace,
    'worker_id', v_worker,
    'document_type_id', v_document_type_id,
    'category', v_category,
    'deleted_qualification_ids', to_jsonb(v_chain_ids),
    'deleted_worker_document_ids', to_jsonb(v_wd_ids),
    'storage_paths', to_jsonb(v_all_paths),
    'cleanup_job_ids', to_jsonb(v_job_ids)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.hard_delete_sst_chain(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hard_delete_sst_chain(uuid) TO authenticated;

-- 3) RPC para marcar status
CREATE OR REPLACE FUNCTION public.mark_storage_cleanup_job_status(
  p_id uuid, p_status text, p_error text DEFAULT NULL
) RETURNS public.worker_document_storage_cleanup_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.worker_document_storage_cleanup_jobs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('pending','completed','failed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023';
  END IF;

  UPDATE public.worker_document_storage_cleanup_jobs
     SET status = p_status,
         attempts = attempts + 1,
         last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE p_error END,
         completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END
   WHERE id = p_id
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleanup_job_not_found' USING ERRCODE='22023';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_storage_cleanup_job_status(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_storage_cleanup_job_status(uuid,text,text) TO authenticated;

-- 4) RPC para listar pendentes
CREATE OR REPLACE FUNCTION public.list_pending_storage_cleanup_jobs(p_limit int DEFAULT 200)
RETURNS SETOF public.worker_document_storage_cleanup_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.worker_document_storage_cleanup_jobs
     WHERE status IN ('pending','failed')
     ORDER BY created_at ASC
     LIMIT greatest(1, coalesce(p_limit, 200));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_pending_storage_cleanup_jobs(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_pending_storage_cleanup_jobs(int) TO authenticated;

-- 5) Backfill dos 7 tombstones de migração
INSERT INTO public.worker_document_storage_cleanup_jobs
  (bucket, path, worker_id, document_type_id, trace_id, source, status)
SELECT
  'worker-documents',
  p.path,
  nullif((cl.new_data->>'worker_id'),'')::uuid,
  nullif((cl.new_data->>'document_type_id'),'')::uuid,
  coalesce(cl.new_data->>'trace_id', 'ghost-migration-backfill'),
  'hard_delete_sst_ghost_migration_backfill',
  'pending'
FROM public.change_logs cl
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(coalesce(cl.new_data->'deleted_qualification_paths','[]'::jsonb)) AS path
  UNION
  SELECT jsonb_array_elements_text(coalesce(cl.new_data->'deleted_worker_document_paths','[]'::jsonb))
  UNION
  SELECT jsonb_array_elements_text(coalesce(cl.new_data->'deleted_worker_document_file_paths','[]'::jsonb))
) p
WHERE cl.action = 'hard_delete_sst_ghost_migration'
  AND p.path IS NOT NULL
  AND p.path <> ''
ON CONFLICT (bucket, path) WHERE status <> 'completed' DO NOTHING;
