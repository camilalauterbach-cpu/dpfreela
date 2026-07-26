CREATE OR REPLACE FUNCTION public.list_worker_qualifications(
  p_document_type_ids uuid[] DEFAULT NULL::uuid[],
  p_search text DEFAULT NULL::text,
  p_state text DEFAULT NULL::text,
  p_only_relevant boolean DEFAULT true,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_only_active_contexts boolean DEFAULT false,
  p_event_id uuid DEFAULT NULL::uuid,
  p_link_group_id uuid DEFAULT NULL::uuid,
  p_job_role_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
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
  v_totals jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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
  WHERE dt.is_active
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
  ctx AS (
    SELECT c.*
    FROM public.resolve_worker_operational_contexts(
      (SELECT array_agg(id) FROM base_workers),
      p_event_id, p_link_group_id, true
    ) c
    WHERE (p_job_role_id IS NULL OR c.job_role_id = p_job_role_id)
  ),
  workers_with_active_ctx AS (
    SELECT DISTINCT worker_id FROM ctx WHERE context_status = 'active'
  ),
  workers_context_unresolved AS (
    SELECT DISTINCT worker_id FROM ctx
    WHERE context_status = 'active' AND context_source = 'unresolved_role'
  ),
  eff AS (
    SELECT
      r.worker_id,
      r.document_type_id,
      bool_or(r.is_mandatory) AS is_mandatory,
      bool_or(r.requirement_resolution_status = 'required') AS any_required,
      array_agg(DISTINCT src) FILTER (WHERE src IS NOT NULL) AS required_by_sources
    FROM public.resolve_effective_document_requirements(
      (SELECT array_agg(id) FROM base_workers),
      p_event_id, p_link_group_id, true
    ) r
    LEFT JOIN LATERAL unnest(r.required_by_sources) AS src ON true
    WHERE (p_job_role_id IS NULL OR r.job_role_id = p_job_role_id OR r.job_role_id IS NULL)
      AND r.document_type_id = ANY(v_column_ids)
    GROUP BY r.worker_id, r.document_type_id
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
           COALESCE(e.any_required, false) AS is_required,
           e.required_by_sources AS required_by_sources,
           (COALESCE(n.worker_document_id, w.worker_document_id) IS NOT NULL) AS has_document,
           EXISTS (SELECT 1 FROM workers_context_unresolved u WHERE u.worker_id = bw.id) AS worker_has_unresolved_ctx
    FROM base_workers bw
    CROSS JOIN public.document_types dt
    LEFT JOIN latest_nr n ON n.worker_id = bw.id AND n.document_type_id = dt.id AND dt.category = 'sst_nr'
    LEFT JOIN latest_wd w ON w.worker_id = bw.id AND w.document_type_id = dt.id AND dt.category <> 'sst_nr'
    LEFT JOIN eff e ON e.worker_id = bw.id AND e.document_type_id = dt.id
    WHERE dt.id = ANY(v_column_ids)
  ),
  scored AS (
    SELECT c.*,
      CASE
        WHEN c.worker_document_id IS NOT NULL THEN
          CASE
            WHEN c.category = 'sst_nr' AND c.nr_validity_status = 'no_expiry' THEN 'ok'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        WHEN c.is_required THEN 'missing'
        WHEN c.worker_has_unresolved_ctx THEN 'context_unresolved'
        ELSE 'not_applicable'
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
        'is_relevant', is_required,
        'is_required', is_required,
        'has_document', has_document,
        'required_by_sources', COALESCE(required_by_sources, ARRAY[]::text[])
      ) ORDER BY document_type_id) AS cells,
      COUNT(*) FILTER (WHERE status='expired') AS c_expired,
      COUNT(*) FILTER (WHERE status='warning') AS c_warning,
      COUNT(*) FILTER (WHERE status='missing') AS c_missing,
      COUNT(*) FILTER (WHERE status='ok') AS c_ok,
      COUNT(*) FILTER (WHERE status='context_unresolved') AS c_ctx_unresolved,
      COUNT(*) FILTER (WHERE status='not_applicable') AS c_not_applicable
    FROM scored
    GROUP BY worker_id, full_name, cpf
  ),
  ctx_summary AS (
    SELECT ctx.worker_id,
      jsonb_agg(DISTINCT jsonb_build_object(
        'employment_link_id', ctx.employment_link_id,
        'link_group_worker_id', ctx.link_group_worker_id,
        'link_group_id', ctx.link_group_id,
        'event_id', ctx.event_id,
        'event_name', ctx.event_name,
        'job_role_id', ctx.job_role_id,
        'job_role_name', ctx.job_role_name,
        'context_source', ctx.context_source,
        'context_status', ctx.context_status
      )) AS contexts,
      COUNT(*) FILTER (WHERE context_status = 'active') AS n_active_ctx,
      COUNT(*) FILTER (WHERE context_status = 'active' AND context_source = 'unresolved_role') AS n_unresolved_ctx
    FROM ctx
    GROUP BY ctx.worker_id
  ),
  filtered AS (
    SELECT a.*, cs.contexts, COALESCE(cs.n_active_ctx,0) AS n_active_ctx, COALESCE(cs.n_unresolved_ctx,0) AS n_unresolved_ctx
    FROM aggregated a
    LEFT JOIN ctx_summary cs ON cs.worker_id = a.worker_id
    WHERE
      (p_only_active_contexts = false OR EXISTS (SELECT 1 FROM workers_with_active_ctx w WHERE w.worker_id = a.worker_id))
      AND (
        p_only_relevant = false
        OR (a.c_expired + a.c_warning + a.c_missing + a.c_ok + a.c_ctx_unresolved) > 0
      )
      AND (
        p_state IS NULL
        OR (p_state = 'expired'            AND a.c_expired > 0)
        OR (p_state = 'warning'            AND a.c_warning > 0)
        OR (p_state = 'missing'            AND a.c_missing > 0)
        OR (p_state = 'context_unresolved' AND a.c_ctx_unresolved > 0)
        OR (p_state = 'ok'                 AND a.c_expired = 0 AND a.c_warning = 0 AND a.c_missing = 0 AND a.c_ctx_unresolved = 0 AND a.c_ok > 0)
      )
  ),
  counted AS (SELECT COUNT(*)::int AS n FROM filtered),
  page AS (
    SELECT * FROM filtered
    ORDER BY (c_expired > 0) DESC, (c_missing > 0) DESC, (c_ctx_unresolved > 0) DESC, (c_warning > 0) DESC, full_name
    LIMIT COALESCE(p_limit, 200) OFFSET COALESCE(p_offset, 0)
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM base_workers)::int AS total_workers,
      (SELECT COUNT(*) FROM ctx WHERE context_status='active')::int AS total_active_contexts,
      (SELECT COALESCE(SUM(c_missing),0) FROM aggregated)::int AS total_missing,
      (SELECT COALESCE(SUM(c_expired),0) FROM aggregated)::int AS total_expired,
      (SELECT COALESCE(SUM(c_warning),0) FROM aggregated)::int AS total_warning,
      (SELECT COALESCE(SUM(c_ctx_unresolved),0) FROM aggregated)::int AS total_context_unresolved,
      (SELECT COALESCE(SUM(c_not_applicable),0) FROM aggregated)::int AS total_not_applicable
  )
  SELECT
    (SELECT n FROM counted),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'worker_id', p.worker_id,
          'worker_name', p.full_name,
          'cpf', p.cpf,
          'cells', p.cells,
          'contexts', COALESCE(p.contexts, '[]'::jsonb),
          'n_active_contexts', p.n_active_ctx,
          'n_unresolved_contexts', p.n_unresolved_ctx,
          'counters', jsonb_build_object(
            'expired', p.c_expired, 'warning', p.c_warning,
            'missing', p.c_missing, 'ok', p.c_ok,
            'context_unresolved', p.c_ctx_unresolved,
            'not_applicable', p.c_not_applicable
          )
        ) ORDER BY (p.c_expired > 0) DESC, (p.c_missing > 0) DESC, (p.c_ctx_unresolved > 0) DESC, (p.c_warning > 0) DESC, p.full_name)
       FROM page p),
      '[]'::jsonb
    ),
    (SELECT jsonb_build_object(
      'total_workers', total_workers,
      'total_active_contexts', total_active_contexts,
      'total_missing', total_missing,
      'total_expired', total_expired,
      'total_warning', total_warning,
      'total_context_unresolved', total_context_unresolved,
      'total_not_applicable', total_not_applicable
    ) FROM totals)
  INTO v_total, v_items, v_totals;

  RETURN jsonb_build_object(
    'schema_version', 2,
    'generated_at', now(),
    'columns', v_columns,
    'total', v_total,
    'items', v_items,
    'totals', v_totals,
    'warning_days', v_warning_days
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_worker_qualifications(uuid[], text, text, boolean, integer, integer, boolean, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_worker_qualifications(uuid[], text, text, boolean, integer, integer, boolean, uuid, uuid, uuid) TO authenticated, service_role;