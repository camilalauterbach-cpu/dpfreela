
CREATE OR REPLACE FUNCTION public.dry_run_job_roles_hygiene()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'forbidden: admin or manager role required' USING ERRCODE = '42501';
  END IF;

  WITH
  -- Uso do catálogo em employment_links (via job_role_id)
  el_use AS (
    SELECT
      job_role_id,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND COALESCE(status, 'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (deleted_at IS NULL AND COALESCE(status, 'active') = 'active')) AS historical_count
    FROM public.employment_links
    WHERE job_role_id IS NOT NULL
    GROUP BY job_role_id
  ),
  -- Uso textual em link_group_workers.job_role (comparado por nome normalizado)
  lgw_role_use AS (
    SELECT
      jr.id AS job_role_id,
      COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL AND COALESCE(lgw.status, 'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (lgw.deleted_at IS NULL AND COALESCE(lgw.status, 'active') = 'active')) AS historical_count
    FROM public.link_group_workers lgw
    JOIN public.job_roles jr
      ON public.f_normalize_job_role(lgw.job_role) = public.f_normalize_job_role(jr.name)
    WHERE lgw.job_role IS NOT NULL AND lgw.job_role <> ''
    GROUP BY jr.id
  ),
  lgw_func_use AS (
    SELECT
      jr.id AS job_role_id,
      COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL AND COALESCE(lgw.status, 'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (lgw.deleted_at IS NULL AND COALESCE(lgw.status, 'active') = 'active')) AS historical_count
    FROM public.link_group_workers lgw
    JOIN public.job_roles jr
      ON public.f_normalize_job_role(lgw.job_function) = public.f_normalize_job_role(jr.name)
    WHERE lgw.job_function IS NOT NULL AND lgw.job_function <> ''
    GROUP BY jr.id
  ),
  el_func_use AS (
    SELECT
      jr.id AS job_role_id,
      COUNT(*) FILTER (WHERE el.deleted_at IS NULL AND COALESCE(el.status, 'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (el.deleted_at IS NULL AND COALESCE(el.status, 'active') = 'active')) AS historical_count
    FROM public.employment_links el
    JOIN public.job_roles jr
      ON public.f_normalize_job_role(el.job_function) = public.f_normalize_job_role(jr.name)
    WHERE el.job_function IS NOT NULL AND el.job_function <> ''
    GROUP BY jr.id
  ),
  req_use AS (
    SELECT job_role_id, COUNT(*) AS req_count
    FROM public.job_role_document_requirements
    GROUP BY job_role_id
  ),
  catalog AS (
    SELECT
      jr.id AS job_role_id,
      jr.code,
      jr.name,
      jr.is_active,
      jr.created_at,
      jr.created_by,
      COALESCE(el.active_count, 0)         AS el_active,
      COALESCE(el.historical_count, 0)     AS el_historical,
      COALESCE(lgw_r.active_count, 0)      AS lgw_role_active,
      COALESCE(lgw_r.historical_count, 0)  AS lgw_role_historical,
      COALESCE(lgw_f.active_count, 0)      AS lgw_func_active,
      COALESCE(lgw_f.historical_count, 0)  AS lgw_func_historical,
      COALESCE(el_f.active_count, 0)       AS el_func_active,
      COALESCE(el_f.historical_count, 0)   AS el_func_historical,
      COALESCE(r.req_count, 0)             AS requirement_count,
      CASE
        WHEN jr.created_by IS NULL AND jr.created_at IS NULL THEN 'desconhecida'
        WHEN jr.created_by IS NULL THEN 'sem_autor_registrado'
        ELSE 'manual_ou_migration'
      END AS origin_hint
    FROM public.job_roles jr
    LEFT JOIN el_use el         ON el.job_role_id = jr.id
    LEFT JOIN lgw_role_use lgw_r ON lgw_r.job_role_id = jr.id
    LEFT JOIN lgw_func_use lgw_f ON lgw_f.job_role_id = jr.id
    LEFT JOIN el_func_use el_f  ON el_f.job_role_id = jr.id
    LEFT JOIN req_use r         ON r.job_role_id = jr.id
  ),
  duplicates AS (
    SELECT
      public.f_normalize_job_role(name) AS normalized_name,
      jsonb_agg(
        jsonb_build_object(
          'id', job_role_id,
          'name', name,
          'code', code,
          'is_active', is_active,
          'active_usage',
            (el_active + lgw_role_active + lgw_func_active + el_func_active),
          'historical_usage',
            (el_historical + lgw_role_historical + lgw_func_historical + el_func_historical),
          'requirement_count', requirement_count
        )
        ORDER BY (el_active + lgw_role_active + lgw_func_active + el_func_active) DESC, name
      ) AS roles,
      COUNT(*) AS role_count
    FROM catalog
    GROUP BY public.f_normalize_job_role(name)
    HAVING COUNT(*) > 1
  ),
  -- Cargos fantasmas: textos livres em três fontes, sem correspondência no catálogo
  ghost_raw AS (
    SELECT
      'link_group_workers.job_role'::text AS source,
      lgw.job_role AS raw_text,
      public.f_normalize_job_role(lgw.job_role) AS normalized,
      lgw.worker_id,
      lg.event_id,
      lgw.link_group_id,
      lgw.created_at,
      lgw.deleted_at,
      COALESCE(lgw.status, 'active') AS status
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_role IS NOT NULL AND btrim(lgw.job_role) <> ''
    UNION ALL
    SELECT
      'link_group_workers.job_function',
      lgw.job_function,
      public.f_normalize_job_role(lgw.job_function),
      lgw.worker_id,
      lg.event_id,
      lgw.link_group_id,
      lgw.created_at,
      lgw.deleted_at,
      COALESCE(lgw.status, 'active')
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_function IS NOT NULL AND btrim(lgw.job_function) <> ''
    UNION ALL
    SELECT
      'employment_links.job_function',
      el.job_function,
      public.f_normalize_job_role(el.job_function),
      el.worker_id,
      el.event_id,
      NULL::uuid,
      el.created_at,
      el.deleted_at,
      COALESCE(el.status, 'active')
    FROM public.employment_links el
    WHERE el.job_function IS NOT NULL AND btrim(el.job_function) <> ''
  ),
  ghost_filtered AS (
    SELECT gr.*
    FROM ghost_raw gr
    LEFT JOIN public.job_roles jr
      ON public.f_normalize_job_role(jr.name) = gr.normalized
    WHERE jr.id IS NULL AND gr.normalized <> ''
  ),
  ghost_agg AS (
    SELECT
      source,
      normalized,
      MIN(raw_text) AS sample_text,
      COUNT(*) AS occurrences,
      COUNT(DISTINCT worker_id) AS workers_affected,
      COUNT(DISTINCT event_id)  AS events_affected,
      COUNT(DISTINCT link_group_id) FILTER (WHERE link_group_id IS NOT NULL) AS groups_affected,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active') AS active_occurrences,
      COUNT(*) FILTER (WHERE NOT (deleted_at IS NULL AND status = 'active')) AS historical_occurrences
    FROM ghost_filtered
    GROUP BY source, normalized
  ),
  ghost_with_suggestion AS (
    SELECT
      ga.*,
      (
        SELECT jsonb_build_object('id', jr.id, 'name', jr.name)
        FROM public.job_roles jr
        WHERE similarity(public.f_normalize_job_role(jr.name), ga.normalized) >= 0.6
        ORDER BY similarity(public.f_normalize_job_role(jr.name), ga.normalized) DESC
        LIMIT 1
      ) AS suggestion
    FROM ghost_agg ga
  ),
  -- Conflitos internos: mesma linha com role != function após normalização
  alloc_conflicts AS (
    SELECT
      lgw.id,
      lgw.link_group_id,
      lg.event_id,
      lgw.worker_id,
      lgw.job_role AS raw_role,
      lgw.job_function AS raw_function,
      public.f_normalize_job_role(lgw.job_role) AS normalized_role,
      public.f_normalize_job_role(lgw.job_function) AS normalized_function,
      lgw.deleted_at IS NULL AND COALESCE(lgw.status, 'active') = 'active' AS is_active
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_role IS NOT NULL AND lgw.job_function IS NOT NULL
      AND btrim(lgw.job_role) <> '' AND btrim(lgw.job_function) <> ''
      AND public.f_normalize_job_role(lgw.job_role) <> public.f_normalize_job_role(lgw.job_function)
  ),
  -- Relação vínculo x alocação: link_group_workers vs employment_links (mesmo worker + evento)
  link_alloc_pairs AS (
    SELECT
      lgw.id AS allocation_id,
      lgw.worker_id,
      lgw.link_group_id,
      lg.event_id,
      lgw.job_role AS alloc_role_text,
      public.f_normalize_job_role(lgw.job_role) AS alloc_role_norm,
      el.id AS employment_link_id,
      el.job_role_id AS link_job_role_id,
      jr.name AS link_role_name,
      public.f_normalize_job_role(jr.name) AS link_role_norm,
      lgw.deleted_at IS NULL AND COALESCE(lgw.status, 'active') = 'active' AS alloc_active
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    LEFT JOIN public.employment_links el
      ON el.worker_id = lgw.worker_id
     AND el.event_id  = lg.event_id
     AND el.deleted_at IS NULL
    LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
  ),
  link_alloc_summary AS (
    SELECT
      COUNT(*)                                                 AS total_allocations,
      COUNT(employment_link_id)                                AS matched_to_link,
      COUNT(*) FILTER (WHERE employment_link_id IS NULL)       AS orphan_allocations,
      COUNT(*) FILTER (
        WHERE employment_link_id IS NOT NULL
          AND link_job_role_id IS NOT NULL
          AND alloc_role_norm <> ''
          AND alloc_role_norm <> link_role_norm
      ) AS divergent_role,
      COUNT(*) FILTER (
        WHERE employment_link_id IS NOT NULL
          AND (link_job_role_id IS NULL OR alloc_role_norm = '' OR alloc_role_norm = link_role_norm)
      ) AS consistent_role,
      COUNT(DISTINCT (worker_id, event_id))                    AS distinct_worker_event_pairs,
      COUNT(DISTINCT worker_id) FILTER (
        WHERE employment_link_id IS NOT NULL
      ) AS workers_with_multiple_allocations_placeholder
    FROM link_alloc_pairs
  ),
  link_multi_alloc AS (
    -- vínculos que possuem mais de uma alocação (múltiplos grupos no mesmo evento)
    SELECT employment_link_id, COUNT(*) AS alloc_count
    FROM link_alloc_pairs
    WHERE employment_link_id IS NOT NULL
    GROUP BY employment_link_id
    HAVING COUNT(*) > 1
  ),
  link_multi_role AS (
    -- vínculos cujas alocações possuem cargos textuais divergentes entre si
    SELECT employment_link_id
    FROM link_alloc_pairs
    WHERE employment_link_id IS NOT NULL AND alloc_role_norm <> ''
    GROUP BY employment_link_id
    HAVING COUNT(DISTINCT alloc_role_norm) > 1
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'summary', jsonb_build_object(
      'catalog_size', (SELECT COUNT(*) FROM catalog),
      'catalog_active', (SELECT COUNT(*) FROM catalog WHERE is_active),
      'catalog_inactive', (SELECT COUNT(*) FROM catalog WHERE NOT is_active),
      'catalog_with_zero_active_use', (
        SELECT COUNT(*) FROM catalog
        WHERE (el_active + lgw_role_active + lgw_func_active + el_func_active) = 0
      ),
      'duplicate_clusters', (SELECT COUNT(*) FROM duplicates),
      'ghost_texts', (SELECT COUNT(*) FROM ghost_agg),
      'ghost_occurrences_total', (SELECT COALESCE(SUM(occurrences), 0) FROM ghost_agg),
      'allocation_conflicts', (SELECT COUNT(*) FROM alloc_conflicts),
      'link_allocation', (SELECT to_jsonb(link_alloc_summary) FROM link_alloc_summary),
      'links_with_multiple_allocations', (SELECT COUNT(*) FROM link_multi_alloc),
      'links_with_divergent_allocation_roles', (SELECT COUNT(*) FROM link_multi_role)
    ),
    'catalog', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', job_role_id,
          'code', code,
          'name', name,
          'is_active', is_active,
          'created_at', created_at,
          'created_by', created_by,
          'origin_hint', origin_hint,
          'employment_links_active', el_active,
          'employment_links_historical', el_historical,
          'lgw_role_active', lgw_role_active,
          'lgw_role_historical', lgw_role_historical,
          'lgw_function_active', lgw_func_active,
          'lgw_function_historical', lgw_func_historical,
          'employment_links_function_active', el_func_active,
          'employment_links_function_historical', el_func_historical,
          'active_usage_total', (el_active + lgw_role_active + lgw_func_active + el_func_active),
          'historical_usage_total', (el_historical + lgw_role_historical + lgw_func_historical + el_func_historical),
          'requirement_count', requirement_count
        )
        ORDER BY (el_active + lgw_role_active + lgw_func_active + el_func_active) DESC, name
      ) FROM catalog
    ), '[]'::jsonb),
    'duplicates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'normalized_name', normalized_name,
          'role_count', role_count,
          'roles', roles
        ) ORDER BY role_count DESC, normalized_name
      ) FROM duplicates
    ), '[]'::jsonb),
    'ghost_texts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'source', source,
          'normalized', normalized,
          'sample_text', sample_text,
          'occurrences', occurrences,
          'active_occurrences', active_occurrences,
          'historical_occurrences', historical_occurrences,
          'workers_affected', workers_affected,
          'events_affected', events_affected,
          'groups_affected', groups_affected,
          'first_seen', first_seen,
          'last_seen', last_seen,
          'suggestion', suggestion,
          'match_confidence', CASE WHEN suggestion IS NULL THEN 'sem_correspondencia_segura' ELSE 'sugestao_por_similaridade' END
        ) ORDER BY occurrences DESC, normalized
      ) FROM ghost_with_suggestion
    ), '[]'::jsonb),
    'allocation_conflicts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'allocation_id', id,
          'link_group_id', link_group_id,
          'event_id', event_id,
          'worker_id', worker_id,
          'job_role_text', raw_role,
          'job_function_text', raw_function,
          'is_active', is_active
        ) ORDER BY is_active DESC, id
      ) FROM alloc_conflicts
    ), '[]'::jsonb),
    'no_active_use', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', job_role_id,
          'name', name,
          'code', code,
          'is_active', is_active,
          'historical_usage_total', (el_historical + lgw_role_historical + lgw_func_historical + el_func_historical),
          'requirement_count', requirement_count
        ) ORDER BY name
      ) FROM catalog
      WHERE (el_active + lgw_role_active + lgw_func_active + el_func_active) = 0
    ), '[]'::jsonb),
    'origin', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', job_role_id,
          'name', name,
          'created_at', created_at,
          'created_by', created_by,
          'origin_hint', origin_hint
        ) ORDER BY created_at NULLS LAST, name
      ) FROM catalog
    ), '[]'::jsonb),
    'link_allocation_relationship', jsonb_build_object(
      'summary', (SELECT to_jsonb(link_alloc_summary) FROM link_alloc_summary),
      'links_with_multiple_allocations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('employment_link_id', employment_link_id, 'allocation_count', alloc_count))
        FROM link_multi_alloc
      ), '[]'::jsonb),
      'links_with_divergent_allocation_roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('employment_link_id', employment_link_id))
        FROM link_multi_role
      ), '[]'::jsonb),
      'orphan_allocations', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'allocation_id', allocation_id,
            'worker_id', worker_id,
            'event_id', event_id,
            'link_group_id', link_group_id,
            'alloc_role_text', alloc_role_text,
            'active', alloc_active
          ) ORDER BY alloc_active DESC
        )
        FROM link_alloc_pairs
        WHERE employment_link_id IS NULL
      ), '[]'::jsonb),
      'divergent_role_samples', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'allocation_id', allocation_id,
            'employment_link_id', employment_link_id,
            'worker_id', worker_id,
            'event_id', event_id,
            'alloc_role_text', alloc_role_text,
            'link_role_name', link_role_name,
            'active', alloc_active
          ) ORDER BY alloc_active DESC
        )
        FROM link_alloc_pairs
        WHERE employment_link_id IS NOT NULL
          AND link_job_role_id IS NOT NULL
          AND alloc_role_norm <> ''
          AND alloc_role_norm <> link_role_norm
      ), '[]'::jsonb)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dry_run_job_roles_hygiene() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dry_run_job_roles_hygiene() TO authenticated;
