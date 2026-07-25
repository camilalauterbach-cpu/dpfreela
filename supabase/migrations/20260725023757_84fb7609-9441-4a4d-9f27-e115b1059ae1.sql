
-- Drop old versions so we can change return shape/labels safely
DROP FUNCTION IF EXISTS public.get_revision_metrics_daily(date, date, uuid);
DROP FUNCTION IF EXISTS public.get_revision_metrics_daily_by_worker(date, date, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_revision_metrics_daily(
  p_from date,
  p_to date,
  p_document_type_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  document_type_id uuid,
  document_type_code text,
  document_type_name text,
  commits_count bigint,
  completed_calls_with_lock bigint,
  idempotent_hit_count bigint,
  avg_lock_wait_ms numeric,
  max_lock_wait_ms numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      (cl.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      NULLIF(cl.new_data->>'document_type_id','')::uuid AS document_type_id,
      NULLIF(cl.new_data->>'trace_id','')::uuid          AS trace_id,
      cl.action                                          AS action,
      NULLIF(cl.new_data->>'lock_wait_ms','')::numeric   AS lock_wait_ms
    FROM public.change_logs cl
    WHERE cl.table_name = 'worker_documents'
      AND cl.action IN (
        'revision.initial','revision.renewal','revision.replacement',
        'revision.correction','revision.idempotent_hit'
      )
      AND (cl.created_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN p_from AND p_to
      AND (p_document_type_id IS NULL
           OR NULLIF(cl.new_data->>'document_type_id','')::uuid = p_document_type_id)
  ),
  dedup AS (
    -- 1 event per (day, document_type_id, trace_id, action)
    SELECT day, document_type_id, trace_id, action,
           MAX(lock_wait_ms) AS lock_wait_ms
      FROM base
     WHERE trace_id IS NOT NULL
     GROUP BY day, document_type_id, trace_id, action
  )
  SELECT
    d.day,
    d.document_type_id,
    dt.code AS document_type_code,
    dt.name AS document_type_name,
    COUNT(DISTINCT d.trace_id) FILTER (
      WHERE d.action IN ('revision.initial','revision.renewal',
                         'revision.replacement','revision.correction')
    )::bigint AS commits_count,
    COUNT(DISTINCT d.trace_id)::bigint AS completed_calls_with_lock,
    COUNT(DISTINCT d.trace_id) FILTER (WHERE d.action = 'revision.idempotent_hit')::bigint AS idempotent_hit_count,
    ROUND(AVG(d.lock_wait_ms)::numeric, 2) AS avg_lock_wait_ms,
    MAX(d.lock_wait_ms)                    AS max_lock_wait_ms
  FROM dedup d
  LEFT JOIN public.document_types dt ON dt.id = d.document_type_id
  GROUP BY d.day, d.document_type_id, dt.code, dt.name
  ORDER BY d.day DESC, dt.code NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_revision_metrics_daily(date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revision_metrics_daily(date,date,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_revision_metrics_daily_by_worker(
  p_from date,
  p_to date,
  p_document_type_id uuid DEFAULT NULL,
  p_worker_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  document_type_id uuid,
  document_type_code text,
  document_type_name text,
  worker_id uuid,
  worker_name text,
  worker_cpf text,
  commits_count bigint,
  completed_calls_with_lock bigint,
  idempotent_hit_count bigint,
  avg_lock_wait_ms numeric,
  max_lock_wait_ms numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      (cl.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      NULLIF(cl.new_data->>'document_type_id','')::uuid AS document_type_id,
      NULLIF(cl.new_data->>'worker_id','')::uuid        AS worker_id,
      NULLIF(cl.new_data->>'trace_id','')::uuid         AS trace_id,
      cl.action                                         AS action,
      NULLIF(cl.new_data->>'lock_wait_ms','')::numeric  AS lock_wait_ms
    FROM public.change_logs cl
    WHERE cl.table_name = 'worker_documents'
      AND cl.action IN (
        'revision.initial','revision.renewal','revision.replacement',
        'revision.correction','revision.idempotent_hit'
      )
      AND (cl.created_at AT TIME ZONE 'America/Sao_Paulo')::date
            BETWEEN p_from AND p_to
      AND (p_document_type_id IS NULL
           OR NULLIF(cl.new_data->>'document_type_id','')::uuid = p_document_type_id)
      AND (p_worker_id IS NULL
           OR NULLIF(cl.new_data->>'worker_id','')::uuid = p_worker_id)
  ),
  dedup AS (
    SELECT day, document_type_id, worker_id, trace_id, action,
           MAX(lock_wait_ms) AS lock_wait_ms
      FROM base
     WHERE trace_id IS NOT NULL
     GROUP BY day, document_type_id, worker_id, trace_id, action
  )
  SELECT
    d.day,
    d.document_type_id,
    dt.code AS document_type_code,
    dt.name AS document_type_name,
    d.worker_id,
    w.full_name AS worker_name,
    CASE
      WHEN w.cpf IS NULL OR length(regexp_replace(w.cpf,'\D','','g')) < 11 THEN NULL
      ELSE '***.' ||
           substring(regexp_replace(w.cpf,'\D','','g') from 4 for 3) || '.' ||
           substring(regexp_replace(w.cpf,'\D','','g') from 7 for 3) || '-**'
    END AS worker_cpf,
    COUNT(DISTINCT d.trace_id) FILTER (
      WHERE d.action IN ('revision.initial','revision.renewal',
                         'revision.replacement','revision.correction')
    )::bigint AS commits_count,
    COUNT(DISTINCT d.trace_id)::bigint AS completed_calls_with_lock,
    COUNT(DISTINCT d.trace_id) FILTER (WHERE d.action = 'revision.idempotent_hit')::bigint AS idempotent_hit_count,
    ROUND(AVG(d.lock_wait_ms)::numeric, 2) AS avg_lock_wait_ms,
    MAX(d.lock_wait_ms)                    AS max_lock_wait_ms
  FROM dedup d
  LEFT JOIN public.document_types dt ON dt.id = d.document_type_id
  LEFT JOIN public.workers        w  ON w.id  = d.worker_id
  GROUP BY d.day, d.document_type_id, dt.code, dt.name, d.worker_id, w.full_name, w.cpf
  ORDER BY d.day DESC, dt.code NULLS LAST, w.full_name NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_revision_metrics_daily_by_worker(date,date,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revision_metrics_daily_by_worker(date,date,uuid,uuid) TO authenticated, service_role;
