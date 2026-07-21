
CREATE OR REPLACE FUNCTION public.list_worker_qualifications(
  p_document_type_ids uuid[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_only_relevant boolean DEFAULT true,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_warning_days int := 30;
  v_columns jsonb;
  v_column_ids uuid[];
  v_items jsonb;
  v_total int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Colunas: types SST/treinamento ativos, filtrados se p_document_type_ids fornecido
  SELECT
    jsonb_agg(jsonb_build_object(
      'document_type_id', dt.id,
      'code', dt.code,
      'name', dt.name,
      'category', dt.category
    ) ORDER BY dt.category, dt.name),
    array_agg(dt.id)
  INTO v_columns, v_column_ids
  FROM public.document_types dt
  WHERE dt.is_active = true
    AND dt.category IN ('sst_nr','sst_aso','training')
    AND (p_document_type_ids IS NULL OR dt.id = ANY(p_document_type_ids));

  v_columns := COALESCE(v_columns, '[]'::jsonb);
  v_column_ids := COALESCE(v_column_ids, ARRAY[]::uuid[]);

  WITH base_workers AS (
    SELECT w.id, w.full_name, w.cpf
    FROM public.workers w
    WHERE w.deleted_at IS NULL
      AND w.merged_into_worker_id IS NULL
      AND (p_search IS NULL OR p_search = ''
           OR w.full_name ILIKE '%'||p_search||'%'
           OR replace(replace(replace(COALESCE(w.cpf,''),'.',''),'-',''),' ','') ILIKE '%'||regexp_replace(p_search,'[^0-9]','','g')||'%')
  ),
  active_links AS (
    SELECT el.worker_id, el.job_role_id, el.id AS link_id
    FROM public.employment_links el
    WHERE el.deleted_at IS NULL
      AND (el.end_date IS NULL OR el.end_date >= CURRENT_DATE)
  ),
  worker_reqs AS (
    -- requisitos por trabalhador via job_role dos vínculos ativos
    SELECT DISTINCT al.worker_id, r.document_type_id
    FROM active_links al
    JOIN public.job_role_document_requirements r ON r.job_role_id = al.job_role_id
    WHERE al.job_role_id IS NOT NULL
    UNION
    -- overrides add
    SELECT DISTINCT al.worker_id, o.document_type_id
    FROM active_links al
    JOIN public.employment_link_document_overrides o
      ON o.employment_link_id = al.link_id
    WHERE o.deleted_at IS NULL AND o.action = 'add'
      AND (o.required_until IS NULL OR o.required_until >= CURRENT_DATE)
  ),
  latest_nr AS (
    SELECT q.worker_id, q.document_type_id,
           q.id AS worker_document_id,
           q.expires_at AS expiry_date,
           q.issued_at AS issue_date,
           q.provider_name AS issuer,
           q.validity_status,
           q.document_url AS file_path
    FROM public.worker_sst_qualifications_current q
    WHERE q.document_type_id = ANY(v_column_ids)
  ),
  latest_wd AS (
    SELECT DISTINCT ON (wd.worker_id, wd.document_type_id)
      wd.worker_id, wd.document_type_id,
      wd.id AS worker_document_id,
      wd.expiry_date, wd.issue_date,
      wd.issuing_authority AS issuer,
      wd.file_path, wd.status AS wd_status
    FROM public.worker_documents wd
    WHERE wd.deleted_at IS NULL
      AND wd.document_type_id = ANY(v_column_ids)
    ORDER BY wd.worker_id, wd.document_type_id, wd.issue_date DESC NULLS LAST, wd.created_at DESC
  ),
  cells AS (
    SELECT bw.id AS worker_id, bw.full_name, bw.cpf,
           dt.id AS document_type_id, dt.category,
           COALESCE(n.worker_document_id, w.worker_document_id) AS worker_document_id,
           COALESCE(n.expiry_date, w.expiry_date) AS expiry_date,
           COALESCE(n.issue_date, w.issue_date) AS issue_date,
           COALESCE(n.issuer, w.issuer) AS issuer,
           COALESCE(n.file_path, w.file_path) AS file_path,
           n.validity_status AS nr_validity_status,
           EXISTS (SELECT 1 FROM worker_reqs wr WHERE wr.worker_id = bw.id AND wr.document_type_id = dt.id) AS is_relevant
    FROM base_workers bw
    CROSS JOIN public.document_types dt
    LEFT JOIN latest_nr n ON n.worker_id = bw.id AND n.document_type_id = dt.id AND dt.category = 'sst_nr'
    LEFT JOIN latest_wd w ON w.worker_id = bw.id AND w.document_type_id = dt.id AND dt.category <> 'sst_nr'
    WHERE dt.id = ANY(v_column_ids)
  ),
  scored AS (
    SELECT c.*,
      CASE
        WHEN c.category = 'sst_nr' THEN
          CASE
            WHEN c.worker_document_id IS NULL THEN CASE WHEN c.is_relevant THEN 'missing' ELSE 'not_applicable' END
            WHEN c.nr_validity_status = 'no_expiry' THEN 'ok'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        ELSE
          CASE
            WHEN c.worker_document_id IS NULL THEN CASE WHEN c.is_relevant THEN 'missing' ELSE 'not_applicable' END
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
      END AS status
    FROM cells c
  ),
  aggregated AS (
    SELECT worker_id, full_name, cpf,
      jsonb_agg(jsonb_build_object(
        'document_type_id', document_type_id,
        'status', status,
        'expiry_date', expiry_date,
        'issue_date', issue_date,
        'issuer', issuer,
        'file_path', file_path,
        'worker_document_id', worker_document_id,
        'is_relevant', is_relevant
      ) ORDER BY document_type_id) AS cells,
      COUNT(*) FILTER (WHERE status='expired') AS c_expired,
      COUNT(*) FILTER (WHERE status='warning') AS c_warning,
      COUNT(*) FILTER (WHERE status='missing') AS c_missing,
      COUNT(*) FILTER (WHERE status='ok') AS c_ok
    FROM scored
    GROUP BY worker_id, full_name, cpf
  ),
  filtered AS (
    SELECT * FROM aggregated
    WHERE
      (p_only_relevant = false
        OR c_expired > 0 OR c_warning > 0 OR c_missing > 0 OR c_ok > 0)
      AND (
        p_state IS NULL
        OR (p_state = 'expired' AND c_expired > 0)
        OR (p_state = 'warning' AND c_warning > 0)
        OR (p_state = 'missing' AND c_missing > 0)
        OR (p_state = 'ok'      AND c_expired = 0 AND c_warning = 0 AND c_missing = 0 AND c_ok > 0)
      )
  ),
  counted AS (SELECT COUNT(*)::int AS n FROM filtered),
  page AS (
    SELECT * FROM filtered
    ORDER BY (c_expired > 0) DESC, (c_missing > 0) DESC, (c_warning > 0) DESC, full_name
    LIMIT COALESCE(p_limit, 200) OFFSET COALESCE(p_offset, 0)
  )
  SELECT
    (SELECT n FROM counted),
    COALESCE(jsonb_agg(jsonb_build_object(
      'worker_id', worker_id,
      'worker_name', full_name,
      'cpf', cpf,
      'cells', cells,
      'counters', jsonb_build_object(
        'expired', c_expired, 'warning', c_warning,
        'missing', c_missing, 'ok', c_ok
      )
    )), '[]'::jsonb)
  INTO v_total, v_items
  FROM page;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'generated_at', now(),
    'columns', v_columns,
    'total', v_total,
    'items', v_items,
    'warning_days', v_warning_days
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_worker_qualifications(uuid[], text, text, boolean, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_worker_qualifications(uuid[], text, text, boolean, int, int) TO authenticated, service_role;
