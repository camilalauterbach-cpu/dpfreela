
-- ============================================================================
-- Q-023 FASE 3 — resolve_effective_document_requirements
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_effective_document_requirements(
  p_worker_ids uuid[] DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_link_group_id uuid DEFAULT NULL,
  p_only_active boolean DEFAULT true
)
RETURNS TABLE (
  worker_id uuid,
  employment_link_id uuid,
  link_group_worker_id uuid,
  link_group_id uuid,
  event_id uuid,
  event_name text,
  job_role_id uuid,
  job_role_name text,
  context_source text,
  context_status text,
  document_type_id uuid,
  code text,
  name text,
  category text,
  is_mandatory boolean,
  allow_waive boolean,
  required_by_sources text[],
  waived_by_sources text[],
  requirement_resolution_status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH ctx AS (
    SELECT *
    FROM public.resolve_worker_operational_contexts(
      p_worker_ids, p_event_id, p_link_group_id, p_only_active
    )
  ),
  -- 1) Globais (aplicam-se a todo contexto operacional ativo)
  global_reqs AS (
    SELECT
      c.worker_id, c.employment_link_id, c.link_group_worker_id, c.link_group_id,
      c.event_id, c.event_name, c.job_role_id, c.job_role_name,
      c.context_source, c.context_status,
      g.document_type_id,
      g.is_mandatory,
      g.allow_waive,
      ARRAY['global']::text[] AS srcs
    FROM ctx c
    JOIN public.global_document_requirements g
      ON g.deleted_at IS NULL
     AND g.is_active
     AND g.applies_to_active_context
    WHERE c.context_status = 'active'
  ),
  -- 2) Cargo
  role_reqs AS (
    SELECT
      c.worker_id, c.employment_link_id, c.link_group_worker_id, c.link_group_id,
      c.event_id, c.event_name, c.job_role_id, c.job_role_name,
      c.context_source, c.context_status,
      r.document_type_id,
      COALESCE(r.is_mandatory, true) AS is_mandatory,
      false AS allow_waive,
      ARRAY['job_role:'||c.job_role_id::text]::text[] AS srcs
    FROM ctx c
    JOIN public.job_role_document_requirements r
      ON r.job_role_id = c.job_role_id
    WHERE c.job_role_id IS NOT NULL
  ),
  -- 3) Evento — mapear por código exato contra document_types
  event_req_codes AS (
    SELECT DISTINCT
      c.event_id,
      UPPER(TRIM(nr_code)) AS code
    FROM ctx c
    JOIN public.events e ON e.id = c.event_id
    LEFT JOIN LATERAL unnest(COALESCE(e.required_nrs, ARRAY[]::text[])) AS nr_code ON true
    WHERE e.deleted_at IS NULL
      AND nr_code IS NOT NULL
      AND TRIM(nr_code) <> ''
  ),
  event_reqs AS (
    SELECT
      c.worker_id, c.employment_link_id, c.link_group_worker_id, c.link_group_id,
      c.event_id, c.event_name, c.job_role_id, c.job_role_name,
      c.context_source, c.context_status,
      dt.id AS document_type_id,
      true AS is_mandatory,
      false AS allow_waive,
      ARRAY['event:'||c.event_id::text]::text[] AS srcs
    FROM ctx c
    JOIN event_req_codes er ON er.event_id = c.event_id
    JOIN public.document_types dt
      ON UPPER(TRIM(dt.code)) = er.code
     AND dt.is_active
  ),
  -- 4) Override add
  override_add AS (
    SELECT
      c.worker_id, c.employment_link_id, c.link_group_worker_id, c.link_group_id,
      c.event_id, c.event_name, c.job_role_id, c.job_role_name,
      c.context_source, c.context_status,
      o.document_type_id,
      true AS is_mandatory,
      false AS allow_waive,
      ARRAY['link_override_add:'||o.id::text]::text[] AS srcs
    FROM ctx c
    JOIN public.employment_link_document_overrides o
      ON o.employment_link_id = c.employment_link_id
     AND o.deleted_at IS NULL
     AND o.action = 'add'
     AND (o.required_until IS NULL OR o.required_until >= CURRENT_DATE)
    WHERE c.employment_link_id IS NOT NULL
  ),
  -- 5) Override waive (para subtração/anotação)
  override_waive AS (
    SELECT
      c.worker_id,
      c.employment_link_id,
      c.link_group_worker_id,
      c.event_id,
      o.document_type_id,
      'link_override_waive:'||o.id::text AS src
    FROM ctx c
    JOIN public.employment_link_document_overrides o
      ON o.employment_link_id = c.employment_link_id
     AND o.deleted_at IS NULL
     AND o.action = 'waive'
     AND (o.required_until IS NULL OR o.required_until >= CURRENT_DATE)
    WHERE c.employment_link_id IS NOT NULL
  ),
  -- União de fontes positivas
  positive AS (
    SELECT * FROM global_reqs
    UNION ALL SELECT * FROM role_reqs
    UNION ALL SELECT * FROM event_reqs
    UNION ALL SELECT * FROM override_add
  ),
  -- Agregado por (context_key, document_type_id)
  agg AS (
    SELECT
      p.worker_id, p.employment_link_id, p.link_group_worker_id, p.link_group_id,
      p.event_id, p.event_name, p.job_role_id, p.job_role_name,
      p.context_source, p.context_status,
      p.document_type_id,
      bool_or(p.is_mandatory) AS is_mandatory,
      bool_or(p.allow_waive)  AS allow_waive,
      array_agg(DISTINCT s) FILTER (WHERE s IS NOT NULL) AS required_by_sources
    FROM positive p
    LEFT JOIN LATERAL unnest(p.srcs) AS s ON true
    GROUP BY 1,2,3,4,5,6,7,8,9,10,11
  )
  SELECT
    a.worker_id, a.employment_link_id, a.link_group_worker_id, a.link_group_id,
    a.event_id, a.event_name, a.job_role_id, a.job_role_name,
    a.context_source, a.context_status,
    a.document_type_id,
    dt.code, dt.name, dt.category::text,
    a.is_mandatory,
    a.allow_waive,
    a.required_by_sources,
    (
      SELECT array_agg(DISTINCT ow.src)
      FROM override_waive ow
      WHERE ow.worker_id = a.worker_id
        AND ow.employment_link_id IS NOT DISTINCT FROM a.employment_link_id
        AND ow.document_type_id = a.document_type_id
    ) AS waived_by_sources,
    CASE
      WHEN a.context_status = 'unresolved' THEN 'context_unresolved'
      WHEN EXISTS (
        SELECT 1 FROM override_waive ow
        WHERE ow.worker_id = a.worker_id
          AND ow.employment_link_id IS NOT DISTINCT FROM a.employment_link_id
          AND ow.document_type_id = a.document_type_id
      ) AND NOT ('global' = ANY(a.required_by_sources) AND NOT a.allow_waive)
        THEN 'waived'
      ELSE 'required'
    END AS requirement_resolution_status
  FROM agg a
  JOIN public.document_types dt ON dt.id = a.document_type_id
  WHERE dt.is_active
    AND (
      dt.category IN ('sst_nr','sst_aso','training')
      OR 'global' = ANY(a.required_by_sources)
    );
$$;

REVOKE ALL ON FUNCTION public.resolve_effective_document_requirements(uuid[], uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_effective_document_requirements(uuid[], uuid, uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_effective_document_requirements(uuid[], uuid, uuid, boolean) IS
'Q-023 F3: composição set-based de requisitos efetivos (global + cargo + evento + overrides). Fonte única para Painel de Qualificações e Controle SST.';

-- ============================================================================
-- Q-023 FASE 4 — list_worker_qualifications v2
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_worker_qualifications(
  p_document_type_ids uuid[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_only_relevant boolean DEFAULT true,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0,
  p_only_active_contexts boolean DEFAULT false,
  p_event_id uuid DEFAULT NULL,
  p_link_group_id uuid DEFAULT NULL,
  p_job_role_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
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

  -- Colunas visíveis (SST/treinamento). Requisitos globais (ex.: ASO) entram automaticamente.
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
  -- Contextos operacionais (formais + legados)
  ctx AS (
    SELECT c.*
    FROM public.resolve_worker_operational_contexts(
      (SELECT array_agg(id) FROM base_workers),
      p_event_id, p_link_group_id, true
    ) c
    WHERE (p_job_role_id IS NULL OR c.job_role_id = p_job_role_id)
  ),
  workers_with_active_ctx AS (
    SELECT DISTINCT worker_id FROM ctx WHERE context_status = 'active' OR context_status = 'unresolved'
  ),
  workers_context_unresolved AS (
    SELECT DISTINCT worker_id FROM ctx WHERE context_status = 'unresolved'
  ),
  -- Requisitos efetivos por (worker, doc_type)
  eff AS (
    SELECT
      r.worker_id,
      r.document_type_id,
      bool_or(r.is_mandatory) AS is_mandatory,
      bool_or(r.requirement_resolution_status = 'context_unresolved') AS any_unresolved,
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
           COALESCE(e.any_unresolved, false) AS ctx_unresolved,
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
        -- 1) Documento existe: sempre reflete a situação documental
        WHEN c.worker_document_id IS NOT NULL THEN
          CASE
            WHEN c.category = 'sst_nr' AND c.nr_validity_status = 'no_expiry' THEN 'ok'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        -- 2) Documento não existe e é exigido
        WHEN c.is_required THEN 'missing'
        -- 3) Documento não existe e trabalhador tem contexto pendente => contexto pendente
        WHEN c.worker_has_unresolved_ctx THEN 'context_unresolved'
        -- 4) Contexto resolvido, não exigido
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
      COUNT(*) FILTER (WHERE context_status = 'unresolved') AS n_unresolved_ctx
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
        -- Alias legado: p_only_relevant esconde apenas quem não tem nenhum documento nem exigência
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
    COALESCE(jsonb_agg(jsonb_build_object(
      'worker_id', worker_id,
      'worker_name', full_name,
      'cpf', cpf,
      'cells', cells,
      'contexts', COALESCE(contexts, '[]'::jsonb),
      'n_active_contexts', n_active_ctx,
      'n_unresolved_contexts', n_unresolved_ctx,
      'counters', jsonb_build_object(
        'expired', c_expired, 'warning', c_warning,
        'missing', c_missing, 'ok', c_ok,
        'context_unresolved', c_ctx_unresolved,
        'not_applicable', c_not_applicable
      )
    )), '[]'::jsonb),
    (SELECT to_jsonb(totals.*) FROM totals)
  INTO v_total, v_items, v_totals
  FROM page;

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

COMMENT ON FUNCTION public.list_worker_qualifications(uuid[], text, text, boolean, int, int, boolean, uuid, uuid, uuid) IS
'Q-023 F4: Painel de Qualificações v2. Consome resolve_worker_operational_contexts + resolve_effective_document_requirements. Introduz cell status context_unresolved.';
