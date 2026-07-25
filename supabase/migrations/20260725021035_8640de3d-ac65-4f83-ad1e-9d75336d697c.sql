
CREATE OR REPLACE FUNCTION public.get_revision_metrics_daily_by_worker(
  p_from date DEFAULT (current_date - interval '30 days')::date,
  p_to date DEFAULT current_date,
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
  lock_acquired_count bigint,
  idempotent_hit_count bigint,
  avg_lock_wait_ms numeric,
  max_lock_wait_ms numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT
      (cl.created_at AT TIME ZONE 'UTC')::date AS day,
      cl.action,
      NULLIF(cl.new_data->>'document_type_id','')::uuid AS document_type_id,
      NULLIF(cl.new_data->>'worker_id','')::uuid AS worker_id,
      NULLIF(cl.new_data->>'lock_wait_ms','')::numeric AS lock_wait_ms
    FROM public.change_logs cl
    WHERE cl.action IN (
        'revision_ready_to_commit',
        'revision_idempotent_hit',
        'lock_acquired',
        'idempotent_hit'
      )
      AND cl.created_at >= p_from
      AND cl.created_at < (p_to + 1)
      AND (p_document_type_id IS NULL
           OR NULLIF(cl.new_data->>'document_type_id','')::uuid = p_document_type_id)
      AND (p_worker_id IS NULL
           OR NULLIF(cl.new_data->>'worker_id','')::uuid = p_worker_id)
  )
  SELECT
    s.day,
    s.document_type_id,
    dt.code AS document_type_code,
    dt.name AS document_type_name,
    s.worker_id,
    w.full_name AS worker_name,
    w.cpf AS worker_cpf,
    COUNT(*) FILTER (WHERE s.action = 'revision_ready_to_commit')::bigint AS commits_count,
    COUNT(*) FILTER (WHERE s.action IN ('revision_ready_to_commit','lock_acquired'))::bigint AS lock_acquired_count,
    COUNT(*) FILTER (WHERE s.action IN ('revision_idempotent_hit','idempotent_hit'))::bigint AS idempotent_hit_count,
    ROUND(AVG(s.lock_wait_ms) FILTER (WHERE s.lock_wait_ms IS NOT NULL), 2) AS avg_lock_wait_ms,
    MAX(s.lock_wait_ms) FILTER (WHERE s.lock_wait_ms IS NOT NULL) AS max_lock_wait_ms
  FROM src s
  LEFT JOIN public.document_types dt ON dt.id = s.document_type_id
  LEFT JOIN public.workers w ON w.id = s.worker_id
  GROUP BY s.day, s.document_type_id, dt.code, dt.name, s.worker_id, w.full_name, w.cpf
  ORDER BY s.day DESC, dt.code NULLS LAST, w.full_name NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION public.get_revision_metrics_daily_by_worker(date, date, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_revision_metrics_daily_by_worker(date, date, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_revision_metrics_daily_by_worker(date, date, uuid, uuid) IS
  'Aggregates canonical worker_documents revision telemetry by day, document_type_id and worker_id from change_logs.';
