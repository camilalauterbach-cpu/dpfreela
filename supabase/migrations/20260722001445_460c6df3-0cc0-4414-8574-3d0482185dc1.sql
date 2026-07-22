
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
  v_similarity_threshold constant real := 0.6;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'forbidden: admin or manager role required' USING ERRCODE = '42501';
  END IF;

  WITH
  -- ============================================================
  -- CATÁLOGO (uso agregado por cargo)
  -- ============================================================
  el_use AS (
    SELECT
      job_role_id,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND COALESCE(status,'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (deleted_at IS NULL AND COALESCE(status,'active') = 'active')) AS historical_count
    FROM public.employment_links
    WHERE job_role_id IS NOT NULL
    GROUP BY job_role_id
  ),
  lgw_role_use AS (
    SELECT jr.id AS job_role_id,
      COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active')) AS historical_count
    FROM public.link_group_workers lgw
    JOIN public.job_roles jr
      ON public.f_normalize_job_role(lgw.job_role) = public.f_normalize_job_role(jr.name)
    WHERE lgw.job_role IS NOT NULL AND lgw.job_role <> ''
    GROUP BY jr.id
  ),
  lgw_func_use AS (
    SELECT jr.id AS job_role_id,
      COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active')) AS historical_count
    FROM public.link_group_workers lgw
    JOIN public.job_roles jr
      ON public.f_normalize_job_role(lgw.job_function) = public.f_normalize_job_role(jr.name)
    WHERE lgw.job_function IS NOT NULL AND lgw.job_function <> ''
    GROUP BY jr.id
  ),
  el_func_use AS (
    SELECT jr.id AS job_role_id,
      COUNT(*) FILTER (WHERE el.deleted_at IS NULL AND COALESCE(el.status,'active') = 'active') AS active_count,
      COUNT(*) FILTER (WHERE NOT (el.deleted_at IS NULL AND COALESCE(el.status,'active') = 'active')) AS historical_count
    FROM public.employment_links el
    JOIN public.job_roles jr
      ON public.f_normalize_job_role(el.job_function) = public.f_normalize_job_role(jr.name)
    WHERE el.job_function IS NOT NULL AND el.job_function <> ''
    GROUP BY jr.id
  ),
  req_use AS (
    SELECT job_role_id, COUNT(*) AS req_count
    FROM public.job_role_document_requirements GROUP BY job_role_id
  ),
  -- Origem via change_logs (trilha de auditoria)
  jr_audit AS (
    SELECT
      cl.record_id AS job_role_id,
      MIN(cl.created_at) FILTER (WHERE cl.action IN ('INSERT','create','created')) AS first_insert_at,
      MIN(cl.changed_by) FILTER (WHERE cl.action IN ('INSERT','create','created')) AS first_insert_by,
      COUNT(*) FILTER (WHERE cl.action IN ('INSERT','create','created')) AS insert_events
    FROM public.change_logs cl
    WHERE cl.table_name = 'job_roles'
    GROUP BY cl.record_id
  ),
  catalog AS (
    SELECT
      jr.id AS job_role_id, jr.code, jr.name, jr.is_active, jr.created_at, jr.created_by,
      COALESCE(el.active_count, 0)         AS el_active,
      COALESCE(el.historical_count, 0)     AS el_historical,
      COALESCE(lgw_r.active_count, 0)      AS lgw_role_active,
      COALESCE(lgw_r.historical_count, 0)  AS lgw_role_historical,
      COALESCE(lgw_f.active_count, 0)      AS lgw_func_active,
      COALESCE(lgw_f.historical_count, 0)  AS lgw_func_historical,
      COALESCE(el_f.active_count, 0)       AS el_func_active,
      COALESCE(el_f.historical_count, 0)   AS el_func_historical,
      COALESCE(r.req_count, 0)             AS requirement_count,
      a.first_insert_at, a.first_insert_by, COALESCE(a.insert_events, 0) AS insert_events,
      CASE
        WHEN a.insert_events > 0 AND a.first_insert_by IS NOT NULL THEN 'manual'
        WHEN a.insert_events > 0 AND a.first_insert_by IS NULL     THEN 'sistema_ou_migration'
        ELSE 'indeterminada'
      END AS origin,
      CASE
        WHEN a.insert_events > 0
          THEN jsonb_build_object('source','change_logs','first_insert_at',a.first_insert_at,'first_insert_by',a.first_insert_by,'events',a.insert_events)
        ELSE NULL
      END AS origin_evidence
    FROM public.job_roles jr
    LEFT JOIN el_use el          ON el.job_role_id = jr.id
    LEFT JOIN lgw_role_use lgw_r ON lgw_r.job_role_id = jr.id
    LEFT JOIN lgw_func_use lgw_f ON lgw_f.job_role_id = jr.id
    LEFT JOIN el_func_use  el_f  ON el_f.job_role_id = jr.id
    LEFT JOIN req_use r          ON r.job_role_id = jr.id
    LEFT JOIN jr_audit a         ON a.job_role_id = jr.id
  ),
  duplicates AS (
    SELECT
      public.f_normalize_job_role(name) AS normalized_name,
      jsonb_agg(jsonb_build_object(
        'id', job_role_id, 'name', name, 'code', code, 'is_active', is_active,
        'active_usage', (el_active + lgw_role_active + lgw_func_active + el_func_active),
        'historical_usage', (el_historical + lgw_role_historical + lgw_func_historical + el_func_historical),
        'requirement_count', requirement_count
      ) ORDER BY (el_active + lgw_role_active + lgw_func_active + el_func_active) DESC, name) AS roles,
      COUNT(*) AS role_count
    FROM catalog
    GROUP BY public.f_normalize_job_role(name)
    HAVING COUNT(*) > 1
  ),

  -- ============================================================
  -- CARGOS FANTASMAS (textos livres sem correspondência)
  -- ============================================================
  ghost_raw AS (
    SELECT 'link_group_workers.job_role'::text AS source, lgw.job_role AS raw_text,
      public.f_normalize_job_role(lgw.job_role) AS normalized,
      lgw.worker_id, lg.event_id, lgw.link_group_id, lgw.created_at, lgw.deleted_at,
      COALESCE(lgw.status, 'active') AS status
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_role IS NOT NULL AND btrim(lgw.job_role) <> ''
    UNION ALL
    SELECT 'link_group_workers.job_function', lgw.job_function,
      public.f_normalize_job_role(lgw.job_function),
      lgw.worker_id, lg.event_id, lgw.link_group_id, lgw.created_at, lgw.deleted_at,
      COALESCE(lgw.status,'active')
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_function IS NOT NULL AND btrim(lgw.job_function) <> ''
    UNION ALL
    SELECT 'employment_links.job_function', el.job_function,
      public.f_normalize_job_role(el.job_function),
      el.worker_id, el.event_id, NULL::uuid, el.created_at, el.deleted_at,
      COALESCE(el.status,'active')
    FROM public.employment_links el
    WHERE el.job_function IS NOT NULL AND btrim(el.job_function) <> ''
  ),
  ghost_filtered AS (
    SELECT gr.* FROM ghost_raw gr
    LEFT JOIN public.job_roles jr ON public.f_normalize_job_role(jr.name) = gr.normalized
    WHERE jr.id IS NULL AND gr.normalized <> ''
  ),
  ghost_agg AS (
    SELECT source, normalized,
      MIN(raw_text) AS sample_text,
      COUNT(*) AS occurrences,
      COUNT(DISTINCT worker_id) AS workers_affected,
      COUNT(DISTINCT event_id) AS events_affected,
      COUNT(DISTINCT link_group_id) FILTER (WHERE link_group_id IS NOT NULL) AS groups_affected,
      MIN(created_at) AS first_seen, MAX(created_at) AS last_seen,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='active') AS active_occurrences,
      COUNT(*) FILTER (WHERE NOT (deleted_at IS NULL AND status='active')) AS historical_occurrences
    FROM ghost_filtered GROUP BY source, normalized
  ),
  ghost_candidates AS (
    SELECT ga.source, ga.normalized, jr.id AS candidate_id, jr.name AS candidate_name,
      similarity(public.f_normalize_job_role(jr.name), ga.normalized) AS score
    FROM ghost_agg ga
    CROSS JOIN public.job_roles jr
    WHERE similarity(public.f_normalize_job_role(jr.name), ga.normalized) >= v_similarity_threshold
  ),
  ghost_top AS (
    SELECT source, normalized,
      (jsonb_agg(jsonb_build_object('id',candidate_id,'name',candidate_name,'score',score) ORDER BY score DESC))[1] AS best,
      (jsonb_agg(jsonb_build_object('id',candidate_id,'name',candidate_name,'score',score) ORDER BY score DESC))[2] AS second,
      COUNT(*) AS candidates_above_threshold
    FROM ghost_candidates GROUP BY source, normalized
  ),
  ghost_with_suggestion AS (
    SELECT ga.*, gt.best, gt.second,
      COALESCE(gt.candidates_above_threshold, 0) AS candidates_above_threshold,
      COALESCE((gt.best->>'score')::real, 0)   AS best_score,
      COALESCE((gt.second->>'score')::real, 0) AS second_score,
      COALESCE((gt.best->>'score')::real, 0) - COALESCE((gt.second->>'score')::real, 0) AS score_delta,
      CASE
        WHEN gt.best IS NULL THEN 'sem_correspondencia_segura'
        WHEN gt.second IS NULL AND (gt.best->>'score')::real >= 0.85 THEN 'sugestao_segura'
        WHEN gt.second IS NULL THEN 'sugestao_por_similaridade'
        WHEN ((gt.best->>'score')::real - (gt.second->>'score')::real) >= 0.15
          AND (gt.best->>'score')::real >= 0.85 THEN 'sugestao_segura'
        ELSE 'sugestao_ambigua'
      END AS match_confidence
    FROM ghost_agg ga
    LEFT JOIN ghost_top gt ON gt.source = ga.source AND gt.normalized = ga.normalized
  ),

  -- ============================================================
  -- CONFLITOS INTERNOS: role != function na mesma alocação
  -- ============================================================
  alloc_conflicts AS (
    SELECT lgw.id, lgw.link_group_id, lg.event_id, lgw.worker_id,
      lgw.job_role AS raw_role, lgw.job_function AS raw_function,
      public.f_normalize_job_role(lgw.job_role) AS normalized_role,
      public.f_normalize_job_role(lgw.job_function) AS normalized_function,
      (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS is_active
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_role IS NOT NULL AND lgw.job_function IS NOT NULL
      AND btrim(lgw.job_role) <> '' AND btrim(lgw.job_function) <> ''
      AND public.f_normalize_job_role(lgw.job_role) <> public.f_normalize_job_role(lgw.job_function)
  ),

  -- ============================================================
  -- BASE DE ALOCAÇÕES (uma linha por link_group_workers.id)
  -- ============================================================
  alloc_base AS (
    SELECT
      lgw.id AS allocation_id,
      lgw.worker_id,
      lgw.link_group_id,
      lg.event_id,
      lgw.job_role AS alloc_role_text,
      public.f_normalize_job_role(lgw.job_role) AS alloc_role_norm,
      COALESCE(lgw.status,'active') AS allocation_status,
      lgw.deleted_at,
      (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS alloc_active
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
  ),
  -- Vínculo corrente = employment_links não excluído E status='active'
  el_current AS (
    SELECT el.id, el.worker_id, el.event_id, el.job_role_id, el.status, el.deleted_at,
           jr.name AS role_name,
           public.f_normalize_job_role(jr.name) AS role_norm
    FROM public.employment_links el
    LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
    WHERE el.deleted_at IS NULL AND COALESCE(el.status,'active') = 'active'
  ),
  alloc_candidates_agg AS (
    SELECT ab.allocation_id,
      COUNT(DISTINCT ec.id) AS candidate_count,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'employment_link_id', ec.id,
        'job_role_id', ec.job_role_id,
        'role_name', ec.role_name,
        'status', ec.status
      )) FILTER (WHERE ec.id IS NOT NULL), '[]'::jsonb) AS candidates
    FROM alloc_base ab
    LEFT JOIN el_current ec
      ON ec.worker_id = ab.worker_id
     AND ec.event_id  = ab.event_id
    GROUP BY ab.allocation_id
  ),
  alloc_classified AS (
    SELECT ab.*,
      ac.candidate_count,
      ac.candidates,
      CASE
        WHEN ac.candidate_count = 0 THEN 'orphan'
        WHEN ac.candidate_count = 1 THEN 'unique_match'
        ELSE 'ambiguous_match'
      END AS classification,
      -- Para unique_match extrai o único vínculo:
      (ac.candidates->0->>'employment_link_id')::uuid AS unique_link_id,
      (ac.candidates->0->>'job_role_id')::uuid AS unique_link_role_id,
      ac.candidates->0->>'role_name' AS unique_link_role_name,
      public.f_normalize_job_role(ac.candidates->0->>'role_name') AS unique_link_role_norm,
      ac.candidates->0->>'status' AS unique_link_status
    FROM alloc_base ab
    JOIN alloc_candidates_agg ac ON ac.allocation_id = ab.allocation_id
  ),
  alloc_role_cls AS (
    SELECT ac.*,
      CASE
        WHEN classification <> 'unique_match' THEN NULL
        WHEN (alloc_role_norm = '' OR alloc_role_norm IS NULL)
             AND (unique_link_role_norm = '' OR unique_link_role_norm IS NULL) THEN 'both_roles_missing'
        WHEN (alloc_role_norm = '' OR alloc_role_norm IS NULL) THEN 'allocation_role_missing'
        WHEN (unique_link_role_norm = '' OR unique_link_role_norm IS NULL) THEN 'link_role_missing'
        WHEN alloc_role_norm = unique_link_role_norm THEN 'equal_role'
        ELSE 'divergent_role'
      END AS role_classification
    FROM alloc_classified ac
  ),

  -- ============================================================
  -- AGREGADOS: cardinalidade e concorrência
  -- ============================================================
  worker_event_pairs AS (
    SELECT worker_id, event_id, COUNT(*) AS c
    FROM el_current
    GROUP BY worker_id, event_id
    HAVING COUNT(*) > 1
  ),
  link_multi_alloc AS (
    SELECT unique_link_id AS employment_link_id,
      COUNT(*) AS alloc_count,
      COUNT(*) FILTER (WHERE alloc_active) AS active_alloc_count,
      COUNT(DISTINCT alloc_role_norm) FILTER (WHERE alloc_role_norm <> '') AS distinct_roles,
      COUNT(DISTINCT alloc_role_norm) FILTER (WHERE alloc_active AND alloc_role_norm <> '') AS distinct_active_roles,
      jsonb_agg(jsonb_build_object(
        'allocation_id', allocation_id,
        'alloc_role_text', alloc_role_text,
        'link_group_id', link_group_id,
        'active', alloc_active
      ) ORDER BY alloc_active DESC) AS allocations
    FROM alloc_role_cls
    WHERE unique_link_id IS NOT NULL
    GROUP BY unique_link_id
  ),

  -- ============================================================
  -- RESUMO
  -- ============================================================
  summary_counts AS (
    SELECT
      COUNT(*) AS total_allocations_distinct,
      COUNT(*) FILTER (WHERE alloc_active) AS active_allocations,
      COUNT(*) FILTER (WHERE NOT alloc_active) AS historical_allocations,
      COUNT(*) FILTER (WHERE classification='unique_match') AS unique_matches_total,
      COUNT(*) FILTER (WHERE classification='unique_match' AND alloc_active) AS unique_matches_active,
      COUNT(*) FILTER (WHERE classification='unique_match' AND NOT alloc_active) AS unique_matches_historical,
      COUNT(*) FILTER (WHERE classification='orphan') AS orphan_allocations_total,
      COUNT(*) FILTER (WHERE classification='orphan' AND alloc_active) AS orphan_allocations_active,
      COUNT(*) FILTER (WHERE classification='orphan' AND NOT alloc_active) AS orphan_allocations_historical,
      COUNT(*) FILTER (WHERE classification='ambiguous_match') AS ambiguous_allocations_total,
      COUNT(*) FILTER (WHERE classification='ambiguous_match' AND alloc_active) AS ambiguous_allocations_active,
      COUNT(*) FILTER (WHERE classification='ambiguous_match' AND NOT alloc_active) AS ambiguous_allocations_historical,
      COUNT(*) FILTER (WHERE role_classification='equal_role') AS equal_role_total,
      COUNT(*) FILTER (WHERE role_classification='equal_role' AND alloc_active) AS equal_role_active,
      COUNT(*) FILTER (WHERE role_classification='equal_role' AND NOT alloc_active) AS equal_role_historical,
      COUNT(*) FILTER (WHERE role_classification='divergent_role') AS divergent_role_total,
      COUNT(*) FILTER (WHERE role_classification='divergent_role' AND alloc_active) AS divergent_role_active,
      COUNT(*) FILTER (WHERE role_classification='divergent_role' AND NOT alloc_active) AS divergent_role_historical,
      COUNT(*) FILTER (WHERE role_classification='allocation_role_missing') AS allocation_role_missing_total,
      COUNT(*) FILTER (WHERE role_classification='allocation_role_missing' AND alloc_active) AS allocation_role_missing_active,
      COUNT(*) FILTER (WHERE role_classification='link_role_missing') AS link_role_missing_total,
      COUNT(*) FILTER (WHERE role_classification='link_role_missing' AND alloc_active) AS link_role_missing_active,
      COUNT(*) FILTER (WHERE role_classification='both_roles_missing') AS both_roles_missing_total,
      COUNT(*) FILTER (WHERE role_classification='both_roles_missing' AND alloc_active) AS both_roles_missing_active
    FROM alloc_role_cls
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'strategy', jsonb_build_object(
      'match_key', 'employment_links.worker_id = link_group_workers.worker_id AND employment_links.event_id = link_groups.event_id',
      'current_link_criteria', 'deleted_at IS NULL AND COALESCE(status,''active'') = ''active''',
      'active_allocation_criteria', 'link_group_workers.deleted_at IS NULL AND COALESCE(status,''active'') = ''active''',
      'cardinality_rule', '0 => orphan; 1 => unique_match; >1 => ambiguous_match (no arbitrary pick)',
      'role_comparison_rule', 'apenas em unique_match: equal_role | divergent_role | allocation_role_missing | link_role_missing | both_roles_missing',
      'unique_worker_event_index_present', false,
      'similarity_threshold', v_similarity_threshold,
      'safe_suggestion_rule', 'best>=0.85 e (delta>=0.15 ou apenas 1 candidato)'
    ),
    'summary', jsonb_build_object(
      'catalog_size', (SELECT COUNT(*) FROM catalog),
      'catalog_active', (SELECT COUNT(*) FROM catalog WHERE is_active),
      'catalog_inactive', (SELECT COUNT(*) FROM catalog WHERE NOT is_active),
      'catalog_with_zero_active_use', (SELECT COUNT(*) FROM catalog WHERE (el_active + lgw_role_active + lgw_func_active + el_func_active) = 0),
      'duplicate_clusters', (SELECT COUNT(*) FROM duplicates),
      'ghost_texts', (SELECT COUNT(*) FROM ghost_agg),
      'ghost_occurrences_total', (SELECT COALESCE(SUM(occurrences),0) FROM ghost_agg),
      'allocation_conflicts_total', (SELECT COUNT(*) FROM alloc_conflicts),
      'allocation_conflicts_active', (SELECT COUNT(*) FROM alloc_conflicts WHERE is_active),
      'allocation_conflicts_historical', (SELECT COUNT(*) FROM alloc_conflicts WHERE NOT is_active),
      'total_allocations_distinct', (SELECT total_allocations_distinct FROM summary_counts),
      'active_allocations', (SELECT active_allocations FROM summary_counts),
      'historical_allocations', (SELECT historical_allocations FROM summary_counts),
      'unique_matches_total', (SELECT unique_matches_total FROM summary_counts),
      'unique_matches_active', (SELECT unique_matches_active FROM summary_counts),
      'unique_matches_historical', (SELECT unique_matches_historical FROM summary_counts),
      'orphan_allocations_total', (SELECT orphan_allocations_total FROM summary_counts),
      'orphan_allocations_active', (SELECT orphan_allocations_active FROM summary_counts),
      'orphan_allocations_historical', (SELECT orphan_allocations_historical FROM summary_counts),
      'ambiguous_allocations_total', (SELECT ambiguous_allocations_total FROM summary_counts),
      'ambiguous_allocations_active', (SELECT ambiguous_allocations_active FROM summary_counts),
      'ambiguous_allocations_historical', (SELECT ambiguous_allocations_historical FROM summary_counts),
      'equal_role_total', (SELECT equal_role_total FROM summary_counts),
      'equal_role_active', (SELECT equal_role_active FROM summary_counts),
      'equal_role_historical', (SELECT equal_role_historical FROM summary_counts),
      'divergent_role_total', (SELECT divergent_role_total FROM summary_counts),
      'divergent_role_active', (SELECT divergent_role_active FROM summary_counts),
      'divergent_role_historical', (SELECT divergent_role_historical FROM summary_counts),
      'allocation_role_missing_total', (SELECT allocation_role_missing_total FROM summary_counts),
      'allocation_role_missing_active', (SELECT allocation_role_missing_active FROM summary_counts),
      'link_role_missing_total', (SELECT link_role_missing_total FROM summary_counts),
      'link_role_missing_active', (SELECT link_role_missing_active FROM summary_counts),
      'both_roles_missing_total', (SELECT both_roles_missing_total FROM summary_counts),
      'both_roles_missing_active', (SELECT both_roles_missing_active FROM summary_counts),
      'worker_event_pairs_with_multiple_current_links', (SELECT COUNT(*) FROM worker_event_pairs),
      'links_with_multiple_allocations', (SELECT COUNT(*) FROM link_multi_alloc WHERE alloc_count > 1),
      'links_with_multiple_active_allocations', (SELECT COUNT(*) FROM link_multi_alloc WHERE active_alloc_count > 1),
      'links_with_distinct_allocation_roles', (SELECT COUNT(*) FROM link_multi_alloc WHERE distinct_roles > 1),
      'links_with_distinct_active_allocation_roles', (SELECT COUNT(*) FROM link_multi_alloc WHERE distinct_active_roles > 1)
    ),
    'catalog', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', job_role_id, 'code', code, 'name', name, 'is_active', is_active,
        'created_at', created_at, 'created_by', created_by,
        'origin', origin, 'origin_evidence', origin_evidence,
        'employment_links_active', el_active, 'employment_links_historical', el_historical,
        'lgw_role_active', lgw_role_active, 'lgw_role_historical', lgw_role_historical,
        'lgw_function_active', lgw_func_active, 'lgw_function_historical', lgw_func_historical,
        'employment_links_function_active', el_func_active, 'employment_links_function_historical', el_func_historical,
        'active_usage_total', (el_active + lgw_role_active + lgw_func_active + el_func_active),
        'historical_usage_total', (el_historical + lgw_role_historical + lgw_func_historical + el_func_historical),
        'requirement_count', requirement_count
      ) ORDER BY (el_active + lgw_role_active + lgw_func_active + el_func_active) DESC, name) FROM catalog
    ), '[]'::jsonb),
    'duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('normalized_name', normalized_name, 'role_count', role_count, 'roles', roles)
        ORDER BY role_count DESC, normalized_name) FROM duplicates
    ), '[]'::jsonb),
    'ghost_texts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'normalized', normalized, 'sample_text', sample_text,
        'occurrences', occurrences, 'active_occurrences', active_occurrences,
        'historical_occurrences', historical_occurrences,
        'workers_affected', workers_affected, 'events_affected', events_affected, 'groups_affected', groups_affected,
        'first_seen', first_seen, 'last_seen', last_seen,
        'best', best, 'best_score', best_score,
        'second', second, 'second_score', second_score,
        'score_delta', score_delta,
        'candidates_above_threshold', candidates_above_threshold,
        'match_confidence', match_confidence
      ) ORDER BY occurrences DESC, normalized) FROM ghost_with_suggestion
    ), '[]'::jsonb),
    'allocation_conflicts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'allocation_id', id, 'link_group_id', link_group_id, 'event_id', event_id,
        'worker_id', worker_id, 'job_role_text', raw_role, 'job_function_text', raw_function,
        'is_active', is_active) ORDER BY is_active DESC, id) FROM alloc_conflicts
    ), '[]'::jsonb),
    'no_active_use', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', job_role_id, 'name', name, 'code', code, 'is_active', is_active,
        'historical_usage_total', (el_historical + lgw_role_historical + lgw_func_historical + el_func_historical),
        'requirement_count', requirement_count) ORDER BY name)
      FROM catalog WHERE (el_active + lgw_role_active + lgw_func_active + el_func_active) = 0
    ), '[]'::jsonb),
    'origin', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', job_role_id, 'name', name, 'created_at', created_at, 'created_by', created_by,
        'origin', origin, 'origin_evidence', origin_evidence) ORDER BY created_at NULLS LAST, name)
      FROM catalog
    ), '[]'::jsonb),
    'link_allocation_relationship', jsonb_build_object(
      -- Amostras (até 10 por grupo)
      'divergent_role_samples_active', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'allocation_id', arc.allocation_id,
            'employment_link_id', arc.unique_link_id,
            'worker_id', arc.worker_id,
            'trabalhador', w.full_name,
            'event_id', arc.event_id,
            'evento', ev.name,
            'link_group_id', arc.link_group_id,
            'grupo', lg.name,
            'alloc_role_text', arc.alloc_role_text,
            'link_role_id', arc.unique_link_role_id,
            'link_role_name', arc.unique_link_role_name,
            'allocation_status', arc.allocation_status,
            'employment_link_status', arc.unique_link_status
          ) AS row_data
          FROM alloc_role_cls arc
          LEFT JOIN public.workers w ON w.id = arc.worker_id
          LEFT JOIN public.events ev ON ev.id = arc.event_id
          LEFT JOIN public.link_groups lg ON lg.id = arc.link_group_id
          WHERE arc.role_classification = 'divergent_role' AND arc.alloc_active
          ORDER BY arc.allocation_id LIMIT 10
        ) s
      ), '[]'::jsonb),
      'orphan_samples_active', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'allocation_id', arc.allocation_id,
            'worker_id', arc.worker_id,
            'trabalhador', w.full_name,
            'event_id', arc.event_id,
            'evento', ev.name,
            'link_group_id', arc.link_group_id,
            'grupo', lg.name,
            'alloc_role_text', arc.alloc_role_text
          ) AS row_data
          FROM alloc_role_cls arc
          LEFT JOIN public.workers w ON w.id = arc.worker_id
          LEFT JOIN public.events ev ON ev.id = arc.event_id
          LEFT JOIN public.link_groups lg ON lg.id = arc.link_group_id
          WHERE arc.classification = 'orphan' AND arc.alloc_active
          ORDER BY arc.allocation_id LIMIT 10
        ) s
      ), '[]'::jsonb),
      'ambiguous_samples', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'allocation_id', arc.allocation_id,
            'worker_id', arc.worker_id,
            'trabalhador', w.full_name,
            'event_id', arc.event_id,
            'evento', ev.name,
            'candidate_count', arc.candidate_count,
            'candidates', arc.candidates,
            'allocation_status', arc.allocation_status
          ) AS row_data
          FROM alloc_role_cls arc
          LEFT JOIN public.workers w ON w.id = arc.worker_id
          LEFT JOIN public.events ev ON ev.id = arc.event_id
          WHERE arc.classification = 'ambiguous_match'
          ORDER BY arc.alloc_active DESC, arc.allocation_id LIMIT 10
        ) s
      ), '[]'::jsonb),
      'links_with_multiple_active_allocations_distinct_roles', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'employment_link_id', lma.employment_link_id,
            'worker_id', ec.worker_id,
            'event_id', ec.event_id,
            'link_role_name', ec.role_name,
            'active_alloc_count', lma.active_alloc_count,
            'distinct_active_roles', lma.distinct_active_roles,
            'allocations', lma.allocations
          ) AS row_data
          FROM link_multi_alloc lma
          LEFT JOIN el_current ec ON ec.id = lma.employment_link_id
          WHERE lma.distinct_active_roles > 1
          ORDER BY lma.active_alloc_count DESC LIMIT 10
        ) s
      ), '[]'::jsonb)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dry_run_job_roles_hygiene() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dry_run_job_roles_hygiene() TO authenticated;
