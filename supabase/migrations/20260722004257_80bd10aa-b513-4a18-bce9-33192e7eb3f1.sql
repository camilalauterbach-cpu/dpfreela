
CREATE OR REPLACE FUNCTION public.dry_run_job_roles_hygiene()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_similarity_threshold constant real := 0.6;
  v_now timestamptz := now();
  v_today date := (v_now)::date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'forbidden: admin or manager role required' USING ERRCODE = '42501';
  END IF;

  WITH
  role_norms AS (
    SELECT jr.id, jr.name, jr.code, jr.is_active, jr.created_at, jr.created_by,
           public.f_normalize_job_role(jr.name) AS n
    FROM public.job_roles jr
  ),
  norm_clusters AS (
    SELECT n, COUNT(*)::int AS role_count, array_agg(id ORDER BY name) AS role_ids
    FROM role_norms GROUP BY n
  ),
  el_all AS (
    SELECT el.id, el.worker_id, el.event_id, el.job_role_id, el.job_function,
           el.status, el.deleted_at, el.hire_date, el.end_date, el.created_at,
           (el.deleted_at IS NULL) AS not_deleted,
           (el.deleted_at IS NULL
              AND (el.hire_date IS NULL OR el.hire_date <= v_today)
              AND (el.end_date  IS NULL OR el.end_date  >= v_today)) AS vigent,
           (el.deleted_at IS NULL AND COALESCE(el.status,'active') = 'active') AS status_active
    FROM public.employment_links el
  ),
  el_status_dist AS (
    SELECT COALESCE(status,'(null)') AS status_value,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS not_deleted
    FROM public.employment_links GROUP BY status
  ),
  el_use AS (
    SELECT job_role_id,
           COUNT(*) FILTER (WHERE status_active)::int         AS active_count,
           COUNT(*) FILTER (WHERE NOT status_active)::int     AS historical_count,
           COUNT(*) FILTER (WHERE vigent)::int                AS vigent_count,
           COUNT(*) FILTER (WHERE status_active AND vigent)::int AS status_active_and_vigent
    FROM el_all
    WHERE job_role_id IS NOT NULL
    GROUP BY job_role_id
  ),
  textual_sources AS (
    SELECT 'link_group_workers.job_role'::text AS source, lgw.job_role AS raw_text,
           public.f_normalize_job_role(lgw.job_role) AS n,
           (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS is_active,
           lgw.worker_id, lg.event_id, lgw.link_group_id, lgw.created_at, lgw.deleted_at, lgw.status
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_role IS NOT NULL AND btrim(lgw.job_role) <> ''
    UNION ALL
    SELECT 'link_group_workers.job_function', lgw.job_function,
           public.f_normalize_job_role(lgw.job_function),
           (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active'),
           lgw.worker_id, lg.event_id, lgw.link_group_id, lgw.created_at, lgw.deleted_at, lgw.status
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_function IS NOT NULL AND btrim(lgw.job_function) <> ''
    UNION ALL
    SELECT 'employment_links.job_function', el.job_function,
           public.f_normalize_job_role(el.job_function),
           (el.deleted_at IS NULL AND COALESCE(el.status,'active') = 'active'),
           el.worker_id, el.event_id, NULL::uuid, el.created_at, el.deleted_at, el.status
    FROM public.employment_links el
    WHERE el.job_function IS NOT NULL AND btrim(el.job_function) <> ''
  ),
  textual_with_cluster AS (
    SELECT ts.*, nc.role_count AS cluster_size, nc.role_ids
    FROM textual_sources ts
    LEFT JOIN norm_clusters nc ON nc.n = ts.n
  ),
  textual_unambiguous AS (
    SELECT role_ids[1] AS job_role_id,
           COUNT(*) FILTER (WHERE is_active)::int AS active_count,
           COUNT(*) FILTER (WHERE NOT is_active)::int AS historical_count
    FROM textual_with_cluster
    WHERE cluster_size = 1 AND n <> ''
    GROUP BY role_ids[1]
  ),
  textual_ambiguous_clusters AS (
    SELECT n AS normalized_name,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE is_active)::int AS active_count,
           COUNT(*) FILTER (WHERE NOT is_active)::int AS historical_count
    FROM textual_with_cluster
    WHERE cluster_size > 1 AND n <> ''
    GROUP BY n
  ),
  req_use AS (
    SELECT job_role_id, COUNT(*)::int AS req_count
    FROM public.job_role_document_requirements GROUP BY job_role_id
  ),
  jr_audit AS (
    SELECT cl.record_id AS job_role_id,
           COUNT(*) FILTER (WHERE cl.action IN ('INSERT','create','created'))::int AS insert_events
    FROM public.change_logs cl
    WHERE cl.table_name = 'job_roles'
    GROUP BY cl.record_id
  ),
  jr_first_event AS (
    SELECT DISTINCT ON (record_id) record_id, created_at, changed_by
    FROM public.change_logs
    WHERE table_name = 'job_roles' AND action IN ('INSERT','create','created')
    ORDER BY record_id, created_at ASC, id ASC
  ),
  catalog AS (
    SELECT rn.id AS job_role_id, rn.code, rn.name, rn.is_active, rn.created_at, rn.created_by,
           COALESCE(el.active_count,0)                  AS el_active,
           COALESCE(el.historical_count,0)              AS el_historical,
           COALESCE(el.vigent_count,0)                  AS el_vigent,
           COALESCE(el.status_active_and_vigent,0)      AS el_status_active_and_vigent,
           COALESCE(tu.active_count,0)                  AS textual_unamb_active,
           COALESCE(tu.historical_count,0)              AS textual_unamb_historical,
           COALESCE(r.req_count,0)                      AS requirement_count,
           fe.created_at                                AS first_insert_at,
           fe.changed_by                                AS first_insert_by,
           COALESCE(a.insert_events,0)                  AS insert_events,
           'indeterminada'::text AS origin,
           CASE
             WHEN a.insert_events > 0 THEN
               jsonb_build_object(
                 'source','change_logs',
                 'first_insert_at', fe.created_at,
                 'first_insert_by', fe.changed_by,
                 'insert_events',   a.insert_events,
                 'note','Evidence available but does not differentiate migration, import, integration, legacy flow, or admin correction; classification remains indeterminada.'
               )
             ELSE
               jsonb_build_object(
                 'source','no_change_logs',
                 'note','No INSERT audit entry found for this job_role; origin remains indeterminada.'
               )
           END AS origin_evidence
    FROM role_norms rn
    LEFT JOIN el_use            el ON el.job_role_id = rn.id
    LEFT JOIN textual_unambiguous tu ON tu.job_role_id = rn.id
    LEFT JOIN req_use            r ON r.job_role_id  = rn.id
    LEFT JOIN jr_audit           a ON a.job_role_id  = rn.id
    LEFT JOIN jr_first_event    fe ON fe.record_id   = rn.id
  ),
  duplicates AS (
    SELECT nc.n AS normalized_name, nc.role_count,
      jsonb_agg(jsonb_build_object(
        'id', c.job_role_id, 'name', c.name, 'code', c.code, 'is_active', c.is_active,
        'active_usage',      (c.el_active + c.textual_unamb_active),
        'historical_usage',  (c.el_historical + c.textual_unamb_historical),
        'requirement_count', c.requirement_count
      ) ORDER BY (c.el_active + c.textual_unamb_active) DESC, c.name) AS roles
    FROM norm_clusters nc
    JOIN role_norms rn ON rn.n = nc.n
    JOIN catalog    c  ON c.job_role_id = rn.id
    WHERE nc.role_count > 1
    GROUP BY nc.n, nc.role_count
  ),
  ghost_raw AS (
    SELECT ts.*
    FROM textual_sources ts
    WHERE ts.n <> ''
      AND NOT EXISTS (SELECT 1 FROM role_norms rn WHERE rn.n = ts.n)
  ),
  ghost_agg AS (
    SELECT source, n AS normalized,
      MIN(raw_text) AS sample_text,
      COUNT(*)::int AS occurrences,
      COUNT(*) FILTER (WHERE is_active)::int AS active_occurrences,
      COUNT(*) FILTER (WHERE NOT is_active)::int AS historical_occurrences,
      COUNT(DISTINCT worker_id)::int AS workers_affected,
      COUNT(DISTINCT event_id)::int AS events_affected,
      COUNT(DISTINCT link_group_id) FILTER (WHERE link_group_id IS NOT NULL)::int AS groups_affected,
      MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
    FROM ghost_raw
    GROUP BY source, n
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
      (jsonb_agg(jsonb_build_object('id',candidate_id,'name',candidate_name,'score',score) ORDER BY score DESC)) -> 0 AS best,
      (jsonb_agg(jsonb_build_object('id',candidate_id,'name',candidate_name,'score',score) ORDER BY score DESC)) -> 1 AS second,
      COUNT(*)::int AS candidates_above_threshold
    FROM ghost_candidates
    GROUP BY source, normalized
  ),
  ghost_with_suggestion AS (
    SELECT ga.*, gt.best, gt.second,
      COALESCE(gt.candidates_above_threshold,0) AS candidates_above_threshold,
      COALESCE((gt.best->>'score')::real,0)     AS best_score,
      COALESCE((gt.second->>'score')::real,0)   AS second_score,
      COALESCE((gt.best->>'score')::real,0) - COALESCE((gt.second->>'score')::real,0) AS score_delta,
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
  alloc_conflicts AS (
    SELECT lgw.id, lgw.link_group_id, lg.event_id, lgw.worker_id,
      lgw.job_role AS raw_role, lgw.job_function AS raw_function,
      (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS is_active
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    WHERE lgw.job_role IS NOT NULL AND lgw.job_function IS NOT NULL
      AND btrim(lgw.job_role) <> '' AND btrim(lgw.job_function) <> ''
      AND public.f_normalize_job_role(lgw.job_role) <> public.f_normalize_job_role(lgw.job_function)
  ),
  alloc_base AS (
    SELECT lgw.id AS allocation_id, lgw.worker_id, lgw.link_group_id, lg.event_id,
      lgw.job_role AS alloc_role_text,
      public.f_normalize_job_role(lgw.job_role) AS alloc_role_norm,
      COALESCE(lgw.status,'active') AS allocation_status,
      lgw.deleted_at AS allocation_deleted_at,
      (lgw.deleted_at IS NULL AND COALESCE(lgw.status,'active') = 'active') AS alloc_status_active,
      (lgw.deleted_at IS NULL
         AND (lgw.hire_date IS NULL OR lgw.hire_date <= v_today)
         AND (lgw.end_date  IS NULL OR lgw.end_date  >= v_today)) AS alloc_vigent,
      lg.deleted_at AS group_deleted_at, lg.status AS group_status, lg.group_name AS group_name,
      (lg.deleted_at IS NULL AND COALESCE(lg.status,'active') = 'active') AS group_status_active,
      (lg.deleted_at IS NULL
         AND (lg.hire_date IS NULL OR lg.hire_date <= v_today)
         AND (lg.end_date  IS NULL OR lg.end_date  >= v_today)) AS group_vigent,
      ev.status AS event_status, ev.deleted_at AS event_deleted_at,
      (ev.deleted_at IS NULL
         AND (ev.start_date IS NULL OR ev.start_date <= v_today)
         AND (ev.end_date   IS NULL OR ev.end_date   >= v_today)) AS event_vigent
    FROM public.link_group_workers lgw
    LEFT JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    LEFT JOIN public.events      ev ON ev.id = lg.event_id
  ),
  el_c_not_deleted AS (
    SELECT id, worker_id, event_id, job_role_id, status FROM el_all WHERE not_deleted
  ),
  el_c_vigent AS (
    SELECT id, worker_id, event_id, job_role_id, status FROM el_all WHERE vigent
  ),
  el_c_status_active AS (
    SELECT id, worker_id, event_id, job_role_id, status FROM el_all WHERE status_active
  ),
  el_c_status_active_and_vigent AS (
    SELECT id, worker_id, event_id, job_role_id, status FROM el_all WHERE status_active AND vigent
  ),
  el_current AS (
    SELECT ec.id, ec.worker_id, ec.event_id, ec.job_role_id, ec.status,
           jr.name AS role_name, public.f_normalize_job_role(jr.name) AS role_norm
    FROM el_c_status_active ec
    LEFT JOIN public.job_roles jr ON jr.id = ec.job_role_id
  ),
  alloc_candidates_agg AS (
    SELECT ab.allocation_id,
      COUNT(DISTINCT ec.id)::int AS candidate_count,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'employment_link_id', ec.id,
        'job_role_id',        ec.job_role_id,
        'role_name',          ec.role_name,
        'status',             ec.status
      )) FILTER (WHERE ec.id IS NOT NULL), '[]'::jsonb) AS candidates
    FROM alloc_base ab
    LEFT JOIN el_current ec ON ec.worker_id = ab.worker_id AND ec.event_id = ab.event_id
    GROUP BY ab.allocation_id
  ),
  distinct_pairs AS (
    SELECT DISTINCT worker_id, event_id FROM alloc_base
  ),
  pair_candidates AS (
    SELECT p.worker_id, p.event_id,
      (SELECT COUNT(*)::int FROM el_c_not_deleted x WHERE x.worker_id=p.worker_id AND x.event_id=p.event_id) AS not_deleted,
      (SELECT COUNT(*)::int FROM el_c_vigent x WHERE x.worker_id=p.worker_id AND x.event_id=p.event_id) AS vigent,
      (SELECT COUNT(*)::int FROM el_c_status_active x WHERE x.worker_id=p.worker_id AND x.event_id=p.event_id) AS status_active,
      (SELECT COUNT(*)::int FROM el_c_status_active_and_vigent x WHERE x.worker_id=p.worker_id AND x.event_id=p.event_id) AS status_active_and_vigent
    FROM distinct_pairs p
  ),
  alloc_classified AS (
    SELECT ab.*, ac.candidate_count, ac.candidates,
      CASE
        WHEN ac.candidate_count = 0 THEN 'orphan'
        WHEN ac.candidate_count = 1 THEN 'unique_match'
        ELSE 'ambiguous_match'
      END AS classification,
      (ac.candidates->0->>'employment_link_id')::uuid AS unique_link_id,
      (ac.candidates->0->>'job_role_id')::uuid       AS unique_link_role_id,
      ac.candidates->0->>'role_name'                 AS unique_link_role_name,
      public.f_normalize_job_role(ac.candidates->0->>'role_name') AS unique_link_role_norm,
      ac.candidates->0->>'status'                    AS unique_link_status
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
  worker_event_pairs AS (
    SELECT worker_id, event_id, COUNT(*)::int AS c
    FROM el_current GROUP BY worker_id, event_id HAVING COUNT(*) > 1
  ),
  link_multi_alloc AS (
    SELECT unique_link_id AS employment_link_id,
      COUNT(*)::int AS alloc_count,
      COUNT(*) FILTER (WHERE alloc_status_active)::int AS active_alloc_count,
      COUNT(DISTINCT alloc_role_norm) FILTER (WHERE alloc_role_norm <> '')::int AS distinct_roles,
      COUNT(DISTINCT alloc_role_norm) FILTER (WHERE alloc_status_active AND alloc_role_norm <> '')::int AS distinct_active_roles,
      jsonb_agg(jsonb_build_object(
        'allocation_id',   allocation_id,
        'alloc_role_text', alloc_role_text,
        'link_group_id',   link_group_id,
        'group_name',      group_name,
        'active',          alloc_status_active
      ) ORDER BY alloc_status_active DESC) AS allocations
    FROM alloc_role_cls
    WHERE unique_link_id IS NOT NULL
    GROUP BY unique_link_id
  ),
  summary_counts AS (
    SELECT
      COUNT(*)::int AS total_allocations_distinct,
      COUNT(*) FILTER (WHERE alloc_status_active)::int AS active_allocations,
      COUNT(*) FILTER (WHERE NOT alloc_status_active)::int AS historical_allocations,
      COUNT(*) FILTER (WHERE classification='unique_match')::int AS unique_matches_total,
      COUNT(*) FILTER (WHERE classification='unique_match' AND alloc_status_active)::int AS unique_matches_active,
      COUNT(*) FILTER (WHERE classification='unique_match' AND NOT alloc_status_active)::int AS unique_matches_historical,
      COUNT(*) FILTER (WHERE classification='orphan')::int AS orphan_allocations_total,
      COUNT(*) FILTER (WHERE classification='orphan' AND alloc_status_active)::int AS orphan_allocations_active,
      COUNT(*) FILTER (WHERE classification='orphan' AND NOT alloc_status_active)::int AS orphan_allocations_historical,
      COUNT(*) FILTER (WHERE classification='ambiguous_match')::int AS ambiguous_allocations_total,
      COUNT(*) FILTER (WHERE classification='ambiguous_match' AND alloc_status_active)::int AS ambiguous_allocations_active,
      COUNT(*) FILTER (WHERE classification='ambiguous_match' AND NOT alloc_status_active)::int AS ambiguous_allocations_historical,
      COUNT(*) FILTER (WHERE role_classification='equal_role')::int AS equal_role_total,
      COUNT(*) FILTER (WHERE role_classification='equal_role' AND alloc_status_active)::int AS equal_role_active,
      COUNT(*) FILTER (WHERE role_classification='equal_role' AND NOT alloc_status_active)::int AS equal_role_historical,
      COUNT(*) FILTER (WHERE role_classification='divergent_role')::int AS divergent_role_total,
      COUNT(*) FILTER (WHERE role_classification='divergent_role' AND alloc_status_active)::int AS divergent_role_active,
      COUNT(*) FILTER (WHERE role_classification='divergent_role' AND NOT alloc_status_active)::int AS divergent_role_historical,
      COUNT(*) FILTER (WHERE role_classification='allocation_role_missing')::int AS allocation_role_missing_total,
      COUNT(*) FILTER (WHERE role_classification='allocation_role_missing' AND alloc_status_active)::int AS allocation_role_missing_active,
      COUNT(*) FILTER (WHERE role_classification='link_role_missing')::int AS link_role_missing_total,
      COUNT(*) FILTER (WHERE role_classification='link_role_missing' AND alloc_status_active)::int AS link_role_missing_active,
      COUNT(*) FILTER (WHERE role_classification='both_roles_missing')::int AS both_roles_missing_total,
      COUNT(*) FILTER (WHERE role_classification='both_roles_missing' AND alloc_status_active)::int AS both_roles_missing_active
    FROM alloc_role_cls
  )
  SELECT jsonb_build_object(
    'generated_at', v_now,
    'strategy', jsonb_build_object(
      'match_key','employment_links.worker_id = link_group_workers.worker_id AND employment_links.event_id = link_groups.event_id',
      'current_link_criteria_used_for_classification','deleted_at IS NULL AND COALESCE(status,''active'') = ''active'' (status-active)',
      'alternative_current_link_criteria', jsonb_build_object(
        'not_deleted','deleted_at IS NULL',
        'vigent_by_dates','deleted_at IS NULL AND (hire_date IS NULL OR hire_date<=today) AND (end_date IS NULL OR end_date>=today)',
        'status_active','deleted_at IS NULL AND COALESCE(status,''active'') = ''active''',
        'status_active_and_vigent','status_active AND vigent_by_dates'
      ),
      'active_allocation_criteria','link_group_workers.deleted_at IS NULL AND COALESCE(status,''active'') = ''active''',
      'cardinality_rule','0 => orphan; 1 => unique_match; >1 => ambiguous_match (no arbitrary pick)',
      'role_comparison_rule','apenas em unique_match: equal_role | divergent_role | allocation_role_missing | link_role_missing | both_roles_missing',
      'operational_context_flags_available','alloc_vigent, group_status, group_vigent, event_status, event_vigent (não afetam a classificação; disponíveis nas amostras)',
      'unique_worker_event_index_present', false,
      'similarity_threshold', v_similarity_threshold,
      'safe_suggestion_rule','best>=0.85 AND (delta>=0.15 OR single candidate)',
      'origin_rule','Origem sempre indeterminada: não é inferida manual apenas por changed_by; sistema_ou_migration não é usado. Autor e data do primeiro evento de INSERT no change_logs são expostos apenas como evidência, sem diferenciar migration, importação, integração, fluxo legado ou correção administrativa.',
      'textual_usage_rule','Uso do cargo separado em três buckets: FK (employment_links.job_role_id), textual inequívoco (normalized com cluster_size=1) e textual ambíguo (cluster_size>1) reportado por cluster.',
      'today', v_today,
      'today_reference','v_today = (now())::date'
    ),
    'summary', jsonb_build_object(
      'catalog_size',(SELECT COUNT(*) FROM catalog),
      'catalog_active',(SELECT COUNT(*) FROM catalog WHERE is_active),
      'catalog_inactive',(SELECT COUNT(*) FROM catalog WHERE NOT is_active),
      'catalog_with_zero_active_use',(SELECT COUNT(*) FROM catalog WHERE (el_active + textual_unamb_active) = 0),
      'duplicate_clusters',(SELECT COUNT(*) FROM duplicates),
      'ambiguous_textual_clusters',(SELECT COUNT(*) FROM textual_ambiguous_clusters),
      'ghost_texts',(SELECT COUNT(*) FROM ghost_agg),
      'ghost_occurrences_total',(SELECT COALESCE(SUM(occurrences),0) FROM ghost_agg),
      'allocation_conflicts_total',(SELECT COUNT(*) FROM alloc_conflicts),
      'allocation_conflicts_active',(SELECT COUNT(*) FROM alloc_conflicts WHERE is_active),
      'allocation_conflicts_historical',(SELECT COUNT(*) FROM alloc_conflicts WHERE NOT is_active),
      'total_allocations_distinct',(SELECT total_allocations_distinct FROM summary_counts),
      'active_allocations',(SELECT active_allocations FROM summary_counts),
      'historical_allocations',(SELECT historical_allocations FROM summary_counts),
      'unique_matches_total',(SELECT unique_matches_total FROM summary_counts),
      'unique_matches_active',(SELECT unique_matches_active FROM summary_counts),
      'unique_matches_historical',(SELECT unique_matches_historical FROM summary_counts),
      'orphan_allocations_total',(SELECT orphan_allocations_total FROM summary_counts),
      'orphan_allocations_active',(SELECT orphan_allocations_active FROM summary_counts),
      'orphan_allocations_historical',(SELECT orphan_allocations_historical FROM summary_counts),
      'ambiguous_allocations_total',(SELECT ambiguous_allocations_total FROM summary_counts),
      'ambiguous_allocations_active',(SELECT ambiguous_allocations_active FROM summary_counts),
      'ambiguous_allocations_historical',(SELECT ambiguous_allocations_historical FROM summary_counts),
      'equal_role_total',(SELECT equal_role_total FROM summary_counts),
      'equal_role_active',(SELECT equal_role_active FROM summary_counts),
      'equal_role_historical',(SELECT equal_role_historical FROM summary_counts),
      'divergent_role_total',(SELECT divergent_role_total FROM summary_counts),
      'divergent_role_active',(SELECT divergent_role_active FROM summary_counts),
      'divergent_role_historical',(SELECT divergent_role_historical FROM summary_counts),
      'allocation_role_missing_total',(SELECT allocation_role_missing_total FROM summary_counts),
      'allocation_role_missing_active',(SELECT allocation_role_missing_active FROM summary_counts),
      'link_role_missing_total',(SELECT link_role_missing_total FROM summary_counts),
      'link_role_missing_active',(SELECT link_role_missing_active FROM summary_counts),
      'both_roles_missing_total',(SELECT both_roles_missing_total FROM summary_counts),
      'both_roles_missing_active',(SELECT both_roles_missing_active FROM summary_counts),
      'worker_event_pairs_with_multiple_current_links',(SELECT COUNT(*) FROM worker_event_pairs),
      'links_with_multiple_allocations',(SELECT COUNT(*) FROM link_multi_alloc WHERE alloc_count > 1),
      'links_with_multiple_active_allocations',(SELECT COUNT(*) FROM link_multi_alloc WHERE active_alloc_count > 1),
      'links_with_distinct_allocation_roles',(SELECT COUNT(*) FROM link_multi_alloc WHERE distinct_roles > 1),
      'links_with_distinct_active_allocation_roles',(SELECT COUNT(*) FROM link_multi_alloc WHERE distinct_active_roles > 1),
      'employment_links_by_status',(
        SELECT COALESCE(jsonb_object_agg(status_value, jsonb_build_object('total',total,'not_deleted',not_deleted)),'{}'::jsonb) FROM el_status_dist
      ),
      'employment_links_not_deleted_total',(SELECT COUNT(*) FROM el_all WHERE not_deleted),
      'employment_links_vigent_total',(SELECT COUNT(*) FROM el_all WHERE vigent),
      'employment_links_status_active_total',(SELECT COUNT(*) FROM el_all WHERE status_active),
      'employment_links_status_active_and_vigent_total',(SELECT COUNT(*) FROM el_all WHERE status_active AND vigent),
      'worker_event_candidate_distribution', jsonb_build_object(
        'not_deleted', jsonb_build_object(
          'pairs_with_0',(SELECT COUNT(*) FROM pair_candidates WHERE not_deleted = 0),
          'pairs_with_1',(SELECT COUNT(*) FROM pair_candidates WHERE not_deleted = 1),
          'pairs_with_gt1',(SELECT COUNT(*) FROM pair_candidates WHERE not_deleted > 1)
        ),
        'vigent', jsonb_build_object(
          'pairs_with_0',(SELECT COUNT(*) FROM pair_candidates WHERE vigent = 0),
          'pairs_with_1',(SELECT COUNT(*) FROM pair_candidates WHERE vigent = 1),
          'pairs_with_gt1',(SELECT COUNT(*) FROM pair_candidates WHERE vigent > 1)
        ),
        'status_active', jsonb_build_object(
          'pairs_with_0',(SELECT COUNT(*) FROM pair_candidates WHERE status_active = 0),
          'pairs_with_1',(SELECT COUNT(*) FROM pair_candidates WHERE status_active = 1),
          'pairs_with_gt1',(SELECT COUNT(*) FROM pair_candidates WHERE status_active > 1)
        ),
        'status_active_and_vigent', jsonb_build_object(
          'pairs_with_0',(SELECT COUNT(*) FROM pair_candidates WHERE status_active_and_vigent = 0),
          'pairs_with_1',(SELECT COUNT(*) FROM pair_candidates WHERE status_active_and_vigent = 1),
          'pairs_with_gt1',(SELECT COUNT(*) FROM pair_candidates WHERE status_active_and_vigent > 1)
        )
      ),
      'input_allocation_rows',(SELECT COUNT(*) FROM public.link_group_workers),
      'classified_allocation_rows',(SELECT COUNT(*) FROM alloc_role_cls),
      'cardinality_ok',((SELECT COUNT(*) FROM public.link_group_workers) = (SELECT COUNT(*) FROM alloc_role_cls))
    ),
    'catalog', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',job_role_id,'code',code,'name',name,'is_active',is_active,
        'created_at',created_at,'created_by',created_by,
        'origin',origin,'origin_evidence',origin_evidence,
        'employment_links_active',el_active,'employment_links_historical',el_historical,
        'employment_links_vigent',el_vigent,
        'employment_links_status_active_and_vigent',el_status_active_and_vigent,
        'textual_unambiguous_active',textual_unamb_active,'textual_unambiguous_historical',textual_unamb_historical,
        'active_usage_total',(el_active + textual_unamb_active),
        'historical_usage_total',(el_historical + textual_unamb_historical),
        'requirement_count',requirement_count
      ) ORDER BY (el_active + textual_unamb_active) DESC, name) FROM catalog
    ),'[]'::jsonb),
    'duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'normalized_name',normalized_name,'role_count',role_count,'roles',roles
      ) ORDER BY role_count DESC, normalized_name) FROM duplicates
    ),'[]'::jsonb),
    'ambiguous_textual_clusters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'normalized_name',normalized_name,'total_occurrences',total,
        'active_occurrences',active_count,'historical_occurrences',historical_count,
        'candidate_job_roles',(
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id',rn.id,'name',rn.name) ORDER BY rn.name), '[]'::jsonb)
          FROM role_norms rn WHERE rn.n = normalized_name)
      ) ORDER BY total DESC, normalized_name) FROM textual_ambiguous_clusters
    ),'[]'::jsonb),
    'ghost_texts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source',source,'normalized',normalized,'sample_text',sample_text,
        'occurrences',occurrences,'active_occurrences',active_occurrences,'historical_occurrences',historical_occurrences,
        'workers_affected',workers_affected,'events_affected',events_affected,'groups_affected',groups_affected,
        'first_seen',first_seen,'last_seen',last_seen,
        'best',best,'best_score',best_score,'second',second,'second_score',second_score,
        'score_delta',score_delta,'candidates_above_threshold',candidates_above_threshold,
        'match_confidence',match_confidence
      ) ORDER BY occurrences DESC, normalized) FROM ghost_with_suggestion
    ),'[]'::jsonb),
    'allocation_conflicts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'allocation_id',id,'link_group_id',link_group_id,'event_id',event_id,
        'worker_id',worker_id,'job_role_text',raw_role,'job_function_text',raw_function,
        'is_active',is_active
      ) ORDER BY is_active DESC, id) FROM alloc_conflicts
    ),'[]'::jsonb),
    'no_active_use', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',job_role_id,'name',name,'code',code,'is_active',is_active,
        'historical_usage_total',(el_historical + textual_unamb_historical),
        'requirement_count',requirement_count) ORDER BY name)
      FROM catalog WHERE (el_active + textual_unamb_active) = 0
    ),'[]'::jsonb),
    'origin', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',job_role_id,'name',name,
        'created_at',created_at,'created_by',created_by,
        'first_insert_at',first_insert_at,'first_insert_by',first_insert_by,
        'origin',origin,'origin_evidence',origin_evidence
      ) ORDER BY created_at NULLS LAST, name)
      FROM catalog
    ),'[]'::jsonb),
    'link_allocation_relationship', jsonb_build_object(
      'divergent_role_samples_active', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'allocation_id',arc.allocation_id,
            'employment_link_id',arc.unique_link_id,
            'worker_id',arc.worker_id,'trabalhador',w.full_name,
            'event_id',arc.event_id,'evento',ev.name,
            'link_group_id',arc.link_group_id,'grupo',arc.group_name,
            'alloc_role_text',arc.alloc_role_text,
            'link_role_id',arc.unique_link_role_id,'link_role_name',arc.unique_link_role_name,
            'allocation_status',arc.allocation_status,'employment_link_status',arc.unique_link_status,
            'alloc_vigent',arc.alloc_vigent,
            'group_status',arc.group_status,'group_vigent',arc.group_vigent,
            'event_status',arc.event_status,'event_vigent',arc.event_vigent
          ) AS row_data
          FROM alloc_role_cls arc
          LEFT JOIN public.workers w ON w.id = arc.worker_id
          LEFT JOIN public.events ev ON ev.id = arc.event_id
          WHERE arc.role_classification = 'divergent_role' AND arc.alloc_status_active
          ORDER BY arc.allocation_id LIMIT 10
        ) s
      ),'[]'::jsonb),
      'orphan_samples_active', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'allocation_id',arc.allocation_id,
            'worker_id',arc.worker_id,'trabalhador',w.full_name,
            'event_id',arc.event_id,'evento',ev.name,
            'link_group_id',arc.link_group_id,'grupo',arc.group_name,
            'alloc_role_text',arc.alloc_role_text,
            'alloc_vigent',arc.alloc_vigent,
            'group_status',arc.group_status,'group_vigent',arc.group_vigent,
            'event_status',arc.event_status,'event_vigent',arc.event_vigent
          ) AS row_data
          FROM alloc_role_cls arc
          LEFT JOIN public.workers w ON w.id = arc.worker_id
          LEFT JOIN public.events ev ON ev.id = arc.event_id
          WHERE arc.classification = 'orphan' AND arc.alloc_status_active
          ORDER BY arc.allocation_id LIMIT 10
        ) s
      ),'[]'::jsonb),
      'ambiguous_samples', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'allocation_id',arc.allocation_id,
            'worker_id',arc.worker_id,'trabalhador',w.full_name,
            'event_id',arc.event_id,'evento',ev.name,
            'link_group_id',arc.link_group_id,'grupo',arc.group_name,
            'candidate_count',arc.candidate_count,'candidates',arc.candidates,
            'allocation_status',arc.allocation_status,'alloc_vigent',arc.alloc_vigent
          ) AS row_data
          FROM alloc_role_cls arc
          LEFT JOIN public.workers w ON w.id = arc.worker_id
          LEFT JOIN public.events ev ON ev.id = arc.event_id
          WHERE arc.classification = 'ambiguous_match'
          ORDER BY arc.alloc_status_active DESC, arc.allocation_id LIMIT 10
        ) s
      ),'[]'::jsonb),
      'links_with_multiple_active_allocations_distinct_roles', COALESCE((
        SELECT jsonb_agg(row_data) FROM (
          SELECT jsonb_build_object(
            'employment_link_id',lma.employment_link_id,
            'worker_id',ec.worker_id,
            'event_id',ec.event_id,'evento',ev.name,
            'link_role_name',ec.role_name,
            'active_alloc_count',lma.active_alloc_count,
            'distinct_active_roles',lma.distinct_active_roles,
            'allocations',lma.allocations
          ) AS row_data
          FROM link_multi_alloc lma
          LEFT JOIN el_current ec ON ec.id = lma.employment_link_id
          LEFT JOIN public.events ev ON ev.id = ec.event_id
          WHERE lma.distinct_active_roles > 1
          ORDER BY lma.active_alloc_count DESC LIMIT 10
        ) s
      ),'[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
