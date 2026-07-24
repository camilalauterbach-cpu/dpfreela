
-- Q-022.A-HOTFIX-ASO
-- Separa atividade operacional da resolução do cargo.
-- context_status passa a refletir SOMENTE atividade operacional.
-- role_resolution é inferido de context_source ('unresolved_role' => não resolvido).

CREATE OR REPLACE FUNCTION public.resolve_worker_operational_contexts(
  p_worker_ids uuid[] DEFAULT NULL::uuid[],
  p_event_id uuid DEFAULT NULL::uuid,
  p_link_group_id uuid DEFAULT NULL::uuid,
  p_only_active boolean DEFAULT true
)
RETURNS TABLE(worker_id uuid, employment_link_id uuid, link_group_worker_id uuid, link_group_id uuid, event_id uuid, event_name text, job_role_id uuid, job_role_name text, context_source text, context_status text, hire_date date, end_date date)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH
  formal AS (
    SELECT
      el.worker_id,
      el.id AS employment_link_id,
      NULL::uuid AS link_group_worker_id,
      NULL::uuid AS link_group_id,
      el.event_id,
      ev.name AS event_name,
      el.job_role_id,
      jr.name AS job_role_name,
      'formal_link'::text AS context_source,
      CASE
        WHEN el.status NOT IN ('cancelled','completed','archived')
         AND (ev.id IS NULL
              OR (ev.deleted_at IS NULL
                  AND COALESCE(ev.status,'') NOT IN ('completed','cancelled','archived')))
         AND (el.end_date IS NULL OR el.end_date >= current_date)
        THEN 'active' ELSE 'historical'
      END AS context_status,
      el.hire_date, el.end_date
    FROM public.employment_links el
    LEFT JOIN public.events ev ON ev.id = el.event_id
    LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
    WHERE el.deleted_at IS NULL
      AND (p_worker_ids IS NULL OR el.worker_id = ANY(p_worker_ids))
      AND (p_event_id IS NULL OR el.event_id = p_event_id)
  ),
  formal_filtered AS (
    SELECT * FROM formal WHERE (NOT p_only_active) OR context_status = 'active'
  ),
  legacy_raw AS (
    SELECT
      lgw.worker_id,
      lgw.id AS link_group_worker_id,
      lgw.link_group_id,
      lg.event_id,
      ev.name AS event_name,
      lgw.job_role_id AS explicit_job_role_id,
      lgw.job_role AS raw_job_role_text,
      lgw.status AS lgw_status,
      lgw.hire_date, lgw.end_date,
      lgw.employment_link_id AS bound_link_id,
      ev.status AS event_status,
      ev.deleted_at AS event_deleted_at,
      lg.deleted_at AS group_deleted_at
    FROM public.link_group_workers lgw
    JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    LEFT JOIN public.events ev ON ev.id = lg.event_id
    WHERE lgw.deleted_at IS NULL
      AND (p_worker_ids IS NULL OR lgw.worker_id = ANY(p_worker_ids))
      AND (p_link_group_id IS NULL OR lgw.link_group_id = p_link_group_id)
      AND (p_event_id IS NULL OR lg.event_id = p_event_id)
  ),
  legacy_resolved AS (
    SELECT lr.*,
      COALESCE(
        (SELECT jr.id FROM public.job_roles jr
          WHERE jr.id = lr.explicit_job_role_id AND jr.is_active = true),
        (
          SELECT jr.id FROM public.job_roles jr
          WHERE jr.is_active = true
            AND lr.raw_job_role_text IS NOT NULL
            AND btrim(lower(jr.name)) = btrim(lower(lr.raw_job_role_text))
          GROUP BY jr.id
          HAVING (SELECT count(*) FROM public.job_roles jr2
                   WHERE jr2.is_active = true
                     AND btrim(lower(jr2.name)) = btrim(lower(lr.raw_job_role_text))) = 1
          LIMIT 1
        )
      ) AS resolved_job_role_id,
      CASE
        WHEN EXISTS(SELECT 1 FROM public.job_roles jr
                    WHERE jr.id = lr.explicit_job_role_id AND jr.is_active = true)
          THEN 'legacy_role_fk'
        WHEN lr.raw_job_role_text IS NOT NULL
         AND (SELECT count(*) FROM public.job_roles jr2
              WHERE jr2.is_active = true
                AND btrim(lower(jr2.name)) = btrim(lower(lr.raw_job_role_text))) = 1
          THEN 'legacy_exact_text_match'
        ELSE 'unresolved_role'
      END AS resolution_source
    FROM legacy_raw lr
  ),
  legacy AS (
    SELECT
      lrr.worker_id,
      NULL::uuid AS employment_link_id,
      lrr.link_group_worker_id,
      lrr.link_group_id,
      lrr.event_id,
      lrr.event_name,
      lrr.resolved_job_role_id AS job_role_id,
      (SELECT jr.name FROM public.job_roles jr WHERE jr.id = lrr.resolved_job_role_id) AS job_role_name,
      lrr.resolution_source AS context_source,
      -- HOTFIX Q-022.A: context_status reflete SOMENTE atividade operacional.
      -- Um contexto com cargo não resolvido pode e deve permanecer 'active'
      -- para receber requisitos globais (ex.: ASO). A resolução do cargo é
      -- indicada por context_source = 'unresolved_role'.
      CASE
        WHEN COALESCE(lrr.lgw_status,'') NOT IN ('completed','cancelled','archived')
         AND lrr.group_deleted_at IS NULL
         AND lrr.event_deleted_at IS NULL
         AND COALESCE(lrr.event_status,'') NOT IN ('completed','cancelled','archived')
         AND (lrr.end_date IS NULL OR lrr.end_date >= current_date)
          THEN 'active'
        ELSE 'historical'
      END AS context_status,
      lrr.hire_date, lrr.end_date,
      lrr.bound_link_id
    FROM legacy_resolved lrr
  ),
  legacy_final AS (
    SELECT worker_id, employment_link_id, link_group_worker_id, link_group_id,
           event_id, event_name, job_role_id, job_role_name,
           context_source, context_status, hire_date, end_date
    FROM legacy l
    WHERE (l.bound_link_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM formal_filtered ff
                           WHERE ff.employment_link_id = l.bound_link_id))
      AND ((NOT p_only_active) OR l.context_status = 'active')
  )
  SELECT * FROM formal_filtered
  UNION ALL
  SELECT * FROM legacy_final;
$function$;


-- Requisitos efetivos: ajusta a classificação de context_unresolved
-- para depender de context_source (não mais de context_status).

CREATE OR REPLACE FUNCTION public.resolve_effective_document_requirements(
  p_worker_ids uuid[] DEFAULT NULL::uuid[],
  p_event_id uuid DEFAULT NULL::uuid,
  p_link_group_id uuid DEFAULT NULL::uuid,
  p_only_active boolean DEFAULT true
)
RETURNS TABLE(worker_id uuid, employment_link_id uuid, link_group_worker_id uuid, link_group_id uuid, event_id uuid, event_name text, job_role_id uuid, job_role_name text, context_source text, context_status text, document_type_id uuid, code text, name text, category text, is_mandatory boolean, allow_waive boolean, required_by_sources text[], waived_by_sources text[], requirement_resolution_status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ctx AS (
    SELECT *
    FROM public.resolve_worker_operational_contexts(
      p_worker_ids, p_event_id, p_link_group_id, p_only_active
    )
  ),
  -- 1) Globais: aplicam-se a TODO contexto operacional ativo,
  --    independentemente da resolução do cargo.
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
  -- 2) Cargo (exige cargo resolvido)
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
      AND c.context_source <> 'unresolved_role'
      AND c.context_status = 'active'
  ),
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
      AND c.context_status = 'active'
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
    WHERE c.context_status = 'active'
  ),
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
  positive AS (
    SELECT * FROM global_reqs
    UNION ALL SELECT * FROM role_reqs
    UNION ALL SELECT * FROM event_reqs
    UNION ALL SELECT * FROM override_add
  ),
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
      -- ASO global (não-dispensável) mantém-se obrigatório mesmo com waive
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
$function$;


-- Painel: usar context_source para detectar cargo não resolvido
-- (context_status agora reflete apenas atividade operacional).

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
    )), '[]'::jsonb)
  INTO v_total, v_items
  FROM page;

  SELECT jsonb_build_object(
    'total_workers', total_workers,
    'total_active_contexts', total_active_contexts,
    'total_missing', total_missing,
    'total_expired', total_expired,
    'total_warning', total_warning,
    'total_context_unresolved', total_context_unresolved,
    'total_not_applicable', total_not_applicable
  ) INTO v_totals FROM totals;

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
