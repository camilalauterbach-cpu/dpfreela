
-- =====================================================================
-- Fase 0A — dry_run_sst_link_readiness()
-- READ-ONLY. Sem DML. SECURITY DEFINER com guarda admin/manager.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.dry_run_sst_link_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report jsonb;
  v_document_types jsonb;
  v_qual_integrity jsonb;
  v_identity jsonb;
  v_flows jsonb;
  v_requirements jsonb;
  v_event_sources jsonb;
  v_overrides jsonb;
  v_link_status jsonb;
  v_multi_link jsonb;
  v_validity jsonb;
  v_preservation jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_summary jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['admin','manager']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- =====================================================================
  -- 1) DOCUMENT TYPES + classificação de política inferida
  -- =====================================================================
  WITH dt AS (
    SELECT
      id, code,
      public.f_normalize_nr_code(code) AS normalized_code,
      name, category, is_active, storage_scope,
      has_expiration, default_validity_days,
      created_at, updated_at,
      CASE
        WHEN has_expiration = false AND default_validity_days IS NULL     THEN 'inferred_no_expiry'
        WHEN has_expiration = true  AND default_validity_days > 0         THEN 'inferred_fixed_duration'
        WHEN has_expiration = true  AND default_validity_days IS NULL     THEN 'inferred_explicit_date'
        WHEN has_expiration = false AND default_validity_days IS NOT NULL THEN 'ambiguous_configuration'
        ELSE 'unknown'
      END AS inferred_policy
    FROM public.document_types
    WHERE category IN ('sst_nr','sst_aso','training')
  )
  SELECT jsonb_agg(to_jsonb(dt) ORDER BY category, code) INTO v_document_types FROM dt;

  -- ambiguous → blockers
  WITH amb AS (
    SELECT jsonb_agg(id ORDER BY id) AS ids, COUNT(*) AS c
    FROM (SELECT * FROM jsonb_to_recordset(v_document_types)
          AS x(id uuid, inferred_policy text)) t
    WHERE inferred_policy = 'ambiguous_configuration'
  )
  SELECT CASE WHEN c > 0 THEN v_blockers || jsonb_build_object(
    'code','document_validity_configuration_ambiguous',
    'severity','critical', 'count', c,
    'description','document_types com has_expiration=false porém default_validity_days não nulo',
    'sample_ids', COALESCE(ids,'[]'::jsonb)
  ) ELSE v_blockers END
  INTO v_blockers FROM amb;

  -- =====================================================================
  -- 2) QUALIFICAÇÕES SST
  -- =====================================================================
  WITH q AS (
    SELECT q.*, dt.code AS dt_code, public.f_normalize_nr_code(dt.code) AS dt_norm
    FROM public.worker_sst_qualifications q
    LEFT JOIN public.document_types dt ON dt.id = q.document_type_id
  ),
  base AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND superseded_at IS NULL) AS current_active,
      COUNT(*) FILTER (WHERE superseded_at IS NOT NULL) AS historical,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL) AS with_expiry,
      COUNT(*) FILTER (WHERE expires_at IS NULL)     AS without_expiry,
      COUNT(*) FILTER (WHERE certificate_file_path IS NOT NULL) AS with_certificate,
      COUNT(*) FILTER (WHERE certificate_file_path IS NULL)     AS without_certificate,
      COUNT(*) FILTER (WHERE document_type_id IS NULL) AS without_document_type_id
    FROM q
  ),
  by_type AS (
    SELECT jsonb_agg(jsonb_build_object('document_type_id', document_type_id,
                                        'code', MAX(dt_code),
                                        'count', COUNT(*))
                     ORDER BY COUNT(*) DESC) AS v
    FROM q WHERE document_type_id IS NOT NULL
    GROUP BY document_type_id
  ),
  by_type_agg AS (SELECT jsonb_agg(v ORDER BY (v->>'count')::int DESC) AS arr FROM by_type),
  by_nr AS (
    SELECT jsonb_agg(jsonb_build_object('nr_code', nr_code, 'count', c) ORDER BY c DESC) AS v
    FROM (SELECT nr_code, COUNT(*) c FROM q GROUP BY nr_code) x
  ),
  by_validity AS (
    SELECT jsonb_agg(jsonb_build_object('validity_status', validity_status, 'count', c)) AS v
    FROM (SELECT validity_status, COUNT(*) c FROM q GROUP BY validity_status) x
  ),
  raw_variants AS (
    SELECT jsonb_agg(jsonb_build_object('nr_code', nr_code, 'count', c) ORDER BY c DESC) AS v
    FROM (SELECT nr_code, COUNT(*) c FROM q GROUP BY nr_code HAVING COUNT(*) > 0) x
  ),
  display_variants AS (
    SELECT jsonb_agg(jsonb_build_object(
      'document_type_id', document_type_id,
      'canonical_code', MAX(dt_code),
      'raw_nr_code', nr_code, 'count', COUNT(*)) ORDER BY COUNT(*) DESC) AS v
    FROM q
    WHERE document_type_id IS NOT NULL
      AND nr_code IS DISTINCT FROM dt_code
      AND public.f_normalize_nr_code(nr_code) = dt_norm
    GROUP BY document_type_id, nr_code
  ),
  true_mm AS (
    SELECT jsonb_agg(jsonb_build_object(
      'qualification_id', id, 'worker_id', worker_id,
      'document_type_id', document_type_id,
      'canonical_code', dt_code, 'raw_nr_code', nr_code)) AS v,
      COUNT(*) AS c,
      jsonb_agg(id) AS sample_ids
    FROM q
    WHERE document_type_id IS NOT NULL
      AND (dt_code IS NULL OR public.f_normalize_nr_code(nr_code) IS DISTINCT FROM dt_norm)
      AND deleted_at IS NULL
  ),
  no_dt AS (
    SELECT jsonb_agg(id) AS sample_ids, COUNT(*) AS c
    FROM q WHERE document_type_id IS NULL AND deleted_at IS NULL
  ),
  dup_current AS (
    SELECT jsonb_agg(jsonb_build_object('worker_id', worker_id,
                                        'document_type_id', document_type_id,
                                        'count', c)) AS v,
           COUNT(*) AS clusters
    FROM (
      SELECT worker_id, document_type_id, COUNT(*) c
      FROM q
      WHERE deleted_at IS NULL AND superseded_at IS NULL AND document_type_id IS NOT NULL
      GROUP BY worker_id, document_type_id
      HAVING COUNT(*) > 1
    ) x
  )
  SELECT jsonb_build_object(
    'totals', to_jsonb(base.*),
    'by_document_type', COALESCE((SELECT arr FROM by_type_agg),'[]'::jsonb),
    'by_nr_code', COALESCE((SELECT v FROM by_nr),'[]'::jsonb),
    'by_validity_status', COALESCE((SELECT v FROM by_validity),'[]'::jsonb),
    'raw_variants', COALESCE((SELECT v FROM raw_variants),'[]'::jsonb),
    'display_variants', COALESCE((SELECT v FROM display_variants),'[]'::jsonb),
    'true_mismatches', jsonb_build_object(
      'count', COALESCE((SELECT c FROM true_mm),0),
      'sample_ids', COALESCE((SELECT sample_ids FROM true_mm),'[]'::jsonb),
      'items', COALESCE((SELECT v FROM true_mm),'[]'::jsonb)),
    'without_document_type_id', jsonb_build_object(
      'count', COALESCE((SELECT c FROM no_dt),0),
      'sample_ids', COALESCE((SELECT sample_ids FROM no_dt),'[]'::jsonb)),
    'current_duplicates', jsonb_build_object(
      'clusters', COALESCE((SELECT clusters FROM dup_current),0),
      'items', COALESCE((SELECT v FROM dup_current),'[]'::jsonb))
  ) INTO v_qual_integrity FROM base;

  -- blockers: true_mismatches, duplicates, without_document_type_id
  IF (v_qual_integrity->'true_mismatches'->>'count')::int > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','qualification_true_code_mismatch','severity','critical',
      'count', (v_qual_integrity->'true_mismatches'->>'count')::int,
      'description','document_type_id e nr_code normalizado divergem',
      'sample_ids', v_qual_integrity->'true_mismatches'->'sample_ids');
  END IF;
  IF (v_qual_integrity->'without_document_type_id'->>'count')::int > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','qualification_without_document_type_id','severity','critical',
      'count', (v_qual_integrity->'without_document_type_id'->>'count')::int,
      'description','Qualificação atual sem document_type_id',
      'sample_ids', v_qual_integrity->'without_document_type_id'->'sample_ids');
  END IF;
  IF (v_qual_integrity->'current_duplicates'->>'clusters')::int > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','duplicate_current_worker_document_type','severity','critical',
      'count', (v_qual_integrity->'current_duplicates'->>'clusters')::int,
      'description','Mesmo worker_id + document_type_id ativo em mais de uma revisão',
      'sample_ids','[]'::jsonb);
  END IF;

  -- =====================================================================
  -- 3) IDENTIDADE CANÔNICA
  -- =====================================================================
  v_identity := jsonb_build_object(
    'primary_identity','worker_id + document_type_id',
    'chain_key_expression','CASE revision_type=additional -> nr_code||":"||id ELSE nr_code',
    'chain_key_uses_text', true,
    'unique_index_active','uq_sst_qual_worker_type_issued_active (worker_id, document_type_id, issued_at) WHERE deleted_at IS NULL AND document_type_id IS NOT NULL',
    'legacy_text_dependencies', jsonb_build_array(
      'worker_sst_qualifications.chain_key (generated from nr_code)',
      'idx_sst_worker_nr (worker_id, nr_code)',
      'idx_sst_nr_code (nr_code)'
    ),
    'frontend_still_sending_nr_code', jsonb_build_array(
      'src/components/workers/sst/SstCertificateDrawer.tsx',
      'src/components/sst/AddSstDialog.tsx',
      'src/components/sst/NrValidityDialog.tsx',
      'src/components/sst/SstRenewDialog.tsx'
    ),
    'display_only_fields', jsonb_build_array('nr_code (mantido por compatibilidade/display)'),
    'register_rpc','public.register_sst_revision'
  );

  IF (v_identity->>'chain_key_uses_text')::boolean = true THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','chain_identity_uses_text','severity','warning','count',1,
      'description','chain_key gerada a partir de nr_code textual — canonicalizar para document_type_id',
      'sample_ids','[]'::jsonb);
  END IF;

  -- =====================================================================
  -- 4) ASO / TREINAMENTOS — fluxos e cobertura
  -- =====================================================================
  v_flows := jsonb_build_object(
    'aso_storage_flow', jsonb_build_object(
      'primary_table','public.worker_documents',
      'sst_master_table','public.worker_sst_qualifications (revisões imutáveis)',
      'creator_rpc','register_sst_revision (quando category=sst_aso)',
      'immutable_history', true,
      'uses_document_type_id', true,
      'auto_calculates_expires_at', false,
      'allows_manual_divergent_validity', true,
      'resolver_reusable_for_q014', true),
    'training_storage_flow', jsonb_build_object(
      'primary_table','public.worker_documents',
      'sst_master_table','public.worker_sst_qualifications (quando promovido)',
      'creator_rpc','register_sst_revision (quando category=training)',
      'immutable_history', true,
      'uses_document_type_id', true,
      'auto_calculates_expires_at', false,
      'allows_manual_divergent_validity', true,
      'resolver_reusable_for_q014', true),
    'gaps_for_q014', jsonb_build_array(
      'ASO ainda não força política do document_type (fixed_duration/explicit_date/no_expiry)',
      'Treinamentos ainda não calculam expires_at server-side por regra do tipo',
      'Frontend permite validade manual divergente para ASO/treinamento'
    )
  );

  WITH aso_covered AS (
    SELECT COUNT(*) c FROM public.worker_sst_qualifications q
    JOIN public.document_types dt ON dt.id=q.document_type_id
    WHERE dt.category='sst_aso' AND q.deleted_at IS NULL AND q.superseded_at IS NULL
  ),
  tr_covered AS (
    SELECT COUNT(*) c FROM public.worker_sst_qualifications q
    JOIN public.document_types dt ON dt.id=q.document_type_id
    WHERE dt.category='training' AND q.deleted_at IS NULL AND q.superseded_at IS NULL
  )
  SELECT
    CASE WHEN (SELECT c FROM aso_covered) = 0
      THEN v_blockers || jsonb_build_object(
        'code','aso_flow_not_covered','severity','warning','count',1,
        'description','Nenhuma qualificação corrente de ASO — Q-014 não coberto para ASO até validação',
        'sample_ids','[]'::jsonb)
      ELSE v_blockers END
  INTO v_blockers;
  SELECT
    CASE WHEN (SELECT c FROM tr_covered) = 0
      THEN v_blockers || jsonb_build_object(
        'code','training_flow_not_covered','severity','warning','count',1,
        'description','Nenhuma qualificação corrente de treinamento — Q-014 não coberto para training até validação',
        'sample_ids','[]'::jsonb)
      ELSE v_blockers END
  INTO v_blockers;

  -- =====================================================================
  -- 5) REQUISITOS DE CARGO
  -- =====================================================================
  WITH r AS (
    SELECT r.*, jr.is_active AS role_active, dt.default_validity_days AS dt_default
    FROM public.job_role_document_requirements r
    LEFT JOIN public.job_roles jr ON jr.id = r.job_role_id
    LEFT JOIN public.document_types dt ON dt.id = r.document_type_id
  ),
  totals AS (
    SELECT
      COUNT(*) total,
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL) with_override,
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND validity_days_override = dt_default) override_equals_default,
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND dt_default IS NOT NULL AND validity_days_override < dt_default) override_shorter,
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND dt_default IS NOT NULL AND validity_days_override > dt_default) override_longer,
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND dt_default IS NULL) override_without_default,
      COUNT(*) FILTER (WHERE role_active = true)  in_active_roles,
      COUNT(*) FILTER (WHERE role_active = false) in_inactive_roles
    FROM r
  ),
  by_role AS (
    SELECT jsonb_agg(jsonb_build_object('job_role_id', job_role_id,'count',c) ORDER BY c DESC) v
    FROM (SELECT job_role_id, COUNT(*) c FROM r GROUP BY job_role_id) x
  ),
  by_type AS (
    SELECT jsonb_agg(jsonb_build_object('document_type_id', document_type_id,'count',c) ORDER BY c DESC) v
    FROM (SELECT document_type_id, COUNT(*) c FROM r GROUP BY document_type_id) x
  ),
  dups AS (
    SELECT COUNT(*) c, jsonb_agg(jsonb_build_object('job_role_id',job_role_id,'document_type_id',document_type_id,'count',c2)) v
    FROM (SELECT job_role_id, document_type_id, COUNT(*) c2
          FROM r GROUP BY job_role_id, document_type_id HAVING COUNT(*)>1) x
  )
  SELECT jsonb_build_object(
    'totals', to_jsonb(totals.*),
    'by_role', COALESCE((SELECT v FROM by_role),'[]'::jsonb),
    'by_document_type', COALESCE((SELECT v FROM by_type),'[]'::jsonb),
    'duplicates', jsonb_build_object('count',COALESCE((SELECT c FROM dups),0),
                                      'items',COALESCE((SELECT v FROM dups),'[]'::jsonb))
  ) INTO v_requirements FROM totals;

  IF (v_requirements->'totals'->>'in_inactive_roles')::int > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','inactive_type_in_active_requirement','severity','warning',
      'count',(v_requirements->'totals'->>'in_inactive_roles')::int,
      'description','Requisitos ainda vinculados a cargos inativos',
      'sample_ids','[]'::jsonb);
  END IF;
  IF (v_requirements->'duplicates'->>'count')::int > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','duplicate_job_role_requirement','severity','critical',
      'count',(v_requirements->'duplicates'->>'count')::int,
      'description','Mesmo job_role_id + document_type_id repetido',
      'sample_ids','[]'::jsonb);
  END IF;

  -- =====================================================================
  -- 6) FONTES DE REQUISITO DE EVENTO
  -- =====================================================================
  WITH ev AS (
    SELECT id, required_nrs, required_nrs_other, requires_epi_form, requires_service_order
    FROM public.events WHERE deleted_at IS NULL
  ),
  ev_nrs AS (
    SELECT id, unnest(required_nrs) AS raw_code FROM ev WHERE array_length(required_nrs,1) > 0
  ),
  ev_nrs_norm AS (
    SELECT id, raw_code, public.f_normalize_nr_code(raw_code) AS norm FROM ev_nrs
  ),
  ev_nrs_match AS (
    SELECT n.id, n.raw_code, n.norm, dt.id AS document_type_id
    FROM ev_nrs_norm n
    LEFT JOIN public.document_types dt
      ON public.f_normalize_nr_code(dt.code) = n.norm
     AND dt.category = 'sst_nr'
  ),
  distinct_vals AS (
    SELECT jsonb_agg(DISTINCT raw_code) AS v FROM ev_nrs
  ),
  unmatched AS (
    SELECT COUNT(*) c, jsonb_agg(jsonb_build_object('event_id',id,'raw_code',raw_code)) v
    FROM ev_nrs_match WHERE document_type_id IS NULL
  ),
  other_free AS (
    SELECT COUNT(*) c FROM ev WHERE COALESCE(TRIM(required_nrs_other),'') <> ''
  )
  SELECT jsonb_build_object(
    'sources', jsonb_build_array(
      jsonb_build_object(
        'table','public.events','field','required_nrs','type','text[]',
        'quantity',(SELECT COUNT(*) FROM ev_nrs),
        'distinct_values', COALESCE((SELECT v FROM distinct_vals),'[]'::jsonb),
        'normalizable',(SELECT COUNT(*) FROM ev_nrs_match WHERE document_type_id IS NOT NULL),
        'unmatched_count',COALESCE((SELECT c FROM unmatched),0),
        'unmatched_items',COALESCE((SELECT v FROM unmatched),'[]'::jsonb),
        'in_evaluate_link_compliance', true,
        'canonicalization_proposal','Substituir events.required_nrs (text[]) por tabela event_document_requirements(document_type_id) e depreciar required_nrs/required_nrs_other'),
      jsonb_build_object(
        'table','public.events','field','required_nrs_other','type','text',
        'quantity',(SELECT c FROM other_free),
        'distinct_values','[]'::jsonb,'normalizable',0,'unmatched_count',(SELECT c FROM other_free),
        'unmatched_items','[]'::jsonb,'in_evaluate_link_compliance', false,
        'canonicalization_proposal','Descontinuar campo de texto livre — sem canonicalização possível'),
      jsonb_build_object(
        'table','public.employment_link_document_overrides','field','(document_type_id)','type','FK',
        'quantity',(SELECT COUNT(*) FROM public.employment_link_document_overrides WHERE deleted_at IS NULL),
        'distinct_values','[]'::jsonb,'normalizable',0,'unmatched_count',0,'unmatched_items','[]'::jsonb,
        'in_evaluate_link_compliance', true,
        'canonicalization_proposal','Já canônico via document_type_id')
    )
  ) INTO v_event_sources;

  IF (SELECT COUNT(*) FROM ev_nrs_match WHERE document_type_id IS NULL) > 0
     OR (SELECT c FROM other_free) > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','event_requirement_not_canonical','severity','critical',
      'count', (SELECT COUNT(*) FROM ev_nrs_match WHERE document_type_id IS NULL) + (SELECT c FROM other_free),
      'description','events.required_nrs / required_nrs_other dependem de texto livre e não estão canonicalizados',
      'sample_ids','[]'::jsonb);
  END IF;

  -- =====================================================================
  -- 7) OVERRIDES
  -- =====================================================================
  WITH o AS (
    SELECT o.*, dt.is_active AS type_active, l.deleted_at AS link_deleted
    FROM public.employment_link_document_overrides o
    LEFT JOIN public.document_types dt ON dt.id = o.document_type_id
    LEFT JOIN public.employment_links l ON l.id = o.employment_link_id
  )
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE deleted_at IS NULL),
    'deleted', COUNT(*) FILTER (WHERE deleted_at IS NOT NULL),
    'add', COUNT(*) FILTER (WHERE action='add' AND deleted_at IS NULL),
    'waive', COUNT(*) FILTER (WHERE action='waive' AND deleted_at IS NULL),
    'with_required_until', COUNT(*) FILTER (WHERE required_until IS NOT NULL AND deleted_at IS NULL),
    'inactive_type_referenced', COUNT(*) FILTER (WHERE type_active = false AND deleted_at IS NULL),
    'historical_link_referenced', COUNT(*) FILTER (WHERE link_deleted IS NOT NULL),
    'uses_document_type_id', true
  ) INTO v_overrides FROM o;

  -- =====================================================================
  -- 8) VÍNCULOS — distribuição e multi-link
  -- =====================================================================
  WITH el AS (
    SELECT l.*, e.deleted_at AS event_deleted, e.start_date AS event_start, e.end_date AS event_end
    FROM public.employment_links l
    LEFT JOIN public.events e ON e.id = l.event_id
  ),
  criteria AS (
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted,
      COUNT(*) FILTER (WHERE deleted_at IS NULL
                        AND (hire_date IS NULL OR hire_date <= CURRENT_DATE)
                        AND (end_date  IS NULL OR end_date  >= CURRENT_DATE)) AS vigent_by_dates,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='active') AS status_active,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='active'
                        AND (hire_date IS NULL OR hire_date <= CURRENT_DATE)
                        AND (end_date  IS NULL OR end_date  >= CURRENT_DATE)) AS status_active_and_vigent,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date IS NOT NULL AND end_date < CURRENT_DATE) AS ended_by_date,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND hire_date IS NOT NULL AND hire_date > CURRENT_DATE) AS future,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND hire_date IS NULL AND end_date IS NULL) AS no_dates,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND event_end IS NOT NULL AND event_end < CURRENT_DATE) AS event_ended,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND event_start IS NOT NULL AND event_start > CURRENT_DATE) AS event_future
    FROM el
  ),
  by_status AS (
    SELECT jsonb_agg(jsonb_build_object('status',status,'count',c)) v
    FROM (SELECT status, COUNT(*) c FROM public.employment_links WHERE deleted_at IS NULL GROUP BY status) x
  ),
  multi AS (
    SELECT worker_id, COUNT(*) c, jsonb_agg(id) link_ids
    FROM public.employment_links
    WHERE deleted_at IS NULL AND status='active'
    GROUP BY worker_id HAVING COUNT(*) > 1
  ),
  multi_detail AS (
    SELECT jsonb_agg(jsonb_build_object(
      'worker_id', w.id,
      'worker_name', w.full_name,
      'active_links_count', m.c,
      'links', (
        SELECT jsonb_agg(jsonb_build_object(
          'employment_link_id', l.id,
          'event_id', l.event_id,
          'event_name', ev.name,
          'job_role_id', l.job_role_id,
          'job_role_name', jr.name,
          'link_status', l.status,
          'hire_date', l.hire_date,
          'end_date', l.end_date,
          'requirements_count', (SELECT COUNT(*) FROM public.job_role_document_requirements
                                  WHERE job_role_id = l.job_role_id),
          'overrides_count', (SELECT COUNT(*) FROM public.employment_link_document_overrides
                               WHERE employment_link_id = l.id AND deleted_at IS NULL)))
        FROM public.employment_links l
        LEFT JOIN public.events ev ON ev.id = l.event_id
        LEFT JOIN public.job_roles jr ON jr.id = l.job_role_id
        WHERE l.id = ANY(SELECT jsonb_array_elements_text(m.link_ids)::uuid))
    )) v, COUNT(*) c
    FROM multi m JOIN public.workers w ON w.id = m.worker_id
  )
  SELECT
    to_jsonb(criteria.*),
    jsonb_build_object(
      'criterion','status=active AND deleted_at IS NULL',
      'worker_count', COALESCE((SELECT c FROM multi_detail),0),
      'items', COALESCE((SELECT v FROM multi_detail),'[]'::jsonb),
      'by_status', COALESCE((SELECT v FROM by_status),'[]'::jsonb))
  INTO v_link_status, v_multi_link
  FROM criteria;

  v_blockers := v_blockers || jsonb_build_object(
    'code','unresolved_multi_link_status_definition','severity','warning','count',1,
    'description','Definição oficial de "vínculo corrente" ainda não foi consolidada — avaliar status vs vigência por datas',
    'sample_ids','[]'::jsonb);

  -- =====================================================================
  -- 9) VALIDADE POR VÍNCULO (simulação analítica, sem persistência)
  -- =====================================================================
  WITH cur AS (
    SELECT q.worker_id, q.document_type_id, q.expires_at, q.issued_at, q.id AS qual_id
    FROM public.worker_sst_qualifications q
    WHERE q.deleted_at IS NULL AND q.superseded_at IS NULL
  ),
  reqs AS (
    SELECT l.id AS link_id, l.worker_id, r.document_type_id, r.validity_days_override
    FROM public.employment_links l
    JOIN public.job_role_document_requirements r ON r.job_role_id = l.job_role_id
    WHERE l.deleted_at IS NULL
  ),
  eff AS (
    SELECT
      reqs.link_id, reqs.worker_id, reqs.document_type_id,
      cur.expires_at AS certificate_expiry,
      reqs.validity_days_override,
      CASE WHEN reqs.validity_days_override IS NOT NULL AND cur.issued_at IS NOT NULL
           THEN cur.issued_at + reqs.validity_days_override END AS role_effective_expiry
    FROM reqs
    LEFT JOIN cur ON cur.worker_id = reqs.worker_id AND cur.document_type_id = reqs.document_type_id
  ),
  shared AS (
    SELECT qual_id, COUNT(DISTINCT link_id) links
    FROM eff e JOIN cur c
      ON c.worker_id=e.worker_id AND c.document_type_id=e.document_type_id
    GROUP BY qual_id HAVING COUNT(DISTINCT link_id) > 1
  )
  SELECT jsonb_build_object(
    'shared_certificates_multiple_links', (SELECT COUNT(*) FROM shared),
    'override_longer_than_certificate', (SELECT COUNT(*) FROM eff
      WHERE role_effective_expiry IS NOT NULL AND certificate_expiry IS NOT NULL
        AND role_effective_expiry > certificate_expiry),
    'override_shorter_than_certificate', (SELECT COUNT(*) FROM eff
      WHERE role_effective_expiry IS NOT NULL AND certificate_expiry IS NOT NULL
        AND role_effective_expiry < certificate_expiry),
    'certificate_without_expiry', (SELECT COUNT(*) FROM eff WHERE certificate_expiry IS NULL),
    'requirement_without_validity_rule', (SELECT COUNT(*) FROM eff WHERE validity_days_override IS NULL),
    'valid_on_a_expired_on_b_by_override', (SELECT COUNT(*) FROM eff
      WHERE role_effective_expiry IS NOT NULL AND role_effective_expiry < CURRENT_DATE
        AND certificate_expiry IS NOT NULL AND certificate_expiry >= CURRENT_DATE)
  ) INTO v_validity;

  -- =====================================================================
  -- 10) PRESERVAÇÃO — baseline
  -- =====================================================================
  WITH gc AS (
    SELECT lg.id AS link_group_id, lg.event_id, lg.group_name, e.name AS event_name,
           COUNT(*) total,
           COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL) not_deleted,
           COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL AND lgw.status='active') status_active,
           COUNT(*) FILTER (WHERE lgw.deleted_at IS NULL
                             AND (lgw.hire_date IS NULL OR lgw.hire_date <= CURRENT_DATE)
                             AND (lgw.end_date  IS NULL OR lgw.end_date  >= CURRENT_DATE)) vigent
    FROM public.link_groups lg
    LEFT JOIN public.events e ON e.id = lg.event_id
    LEFT JOIN public.link_group_workers lgw ON lgw.link_group_id = lg.id
    WHERE lg.deleted_at IS NULL
    GROUP BY lg.id, lg.event_id, lg.group_name, e.name
  )
  SELECT jsonb_build_object(
    'group_worker_counts', COALESCE(jsonb_agg(to_jsonb(gc.*) ORDER BY event_name, group_name),'[]'::jsonb),
    'expected_rock_in_rio', 56,
    'expected_shakira', 29,
    'worker_sst_qualifications_total', (SELECT COUNT(*) FROM public.worker_sst_qualifications),
    'worker_sst_qualifications_current', (SELECT COUNT(*) FROM public.worker_sst_qualifications
                                            WHERE deleted_at IS NULL AND superseded_at IS NULL),
    'worker_sst_qualifications_history', (SELECT COUNT(*) FROM public.worker_sst_qualifications
                                            WHERE superseded_at IS NOT NULL),
    'worker_documents_total', (SELECT COUNT(*) FROM public.worker_documents),
    'employment_links_total', (SELECT COUNT(*) FROM public.employment_links WHERE deleted_at IS NULL),
    'link_group_workers_total', (SELECT COUNT(*) FROM public.link_group_workers WHERE deleted_at IS NULL),
    'job_role_requirements_total', (SELECT COUNT(*) FROM public.job_role_document_requirements),
    'overrides_total', (SELECT COUNT(*) FROM public.employment_link_document_overrides WHERE deleted_at IS NULL)
  ) INTO v_preservation FROM gc;

  -- =====================================================================
  -- SUMMARY
  -- =====================================================================
  v_summary := jsonb_build_object(
    'document_types_total', jsonb_array_length(COALESCE(v_document_types,'[]'::jsonb)),
    'qualifications_total', (v_qual_integrity->'totals'->>'total')::int,
    'qualifications_current', (v_qual_integrity->'totals'->>'current_active')::int,
    'requirements_total', (v_requirements->'totals'->>'total')::int,
    'overrides_active', (v_overrides->>'active')::int,
    'employment_links_not_deleted', (v_link_status->>'not_deleted')::int,
    'multi_link_active_workers', (v_multi_link->>'worker_count')::int,
    'blockers_count', jsonb_array_length(v_blockers)
  );

  v_report := jsonb_build_object(
    'schema_version', 1,
    'generated_at', now(),
    'strategy', jsonb_build_object(
      'phase','0A',
      'read_only', true,
      'no_dml', true,
      'notes','Diagnóstico integral SST + vínculos. Nenhuma tabela operacional foi alterada.'
    ),
    'summary', v_summary,
    'document_types', v_document_types,
    'qualification_integrity', v_qual_integrity,
    'identity', v_identity,
    'flows', v_flows,
    'requirements', v_requirements,
    'event_requirement_sources', v_event_sources,
    'overrides', v_overrides,
    'link_status_distribution', v_link_status,
    'multi_link_workers', v_multi_link,
    'per_link_validity_simulation', v_validity,
    'preservation_baseline', v_preservation,
    'blockers', v_blockers
  );

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.dry_run_sst_link_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dry_run_sst_link_readiness() FROM anon;
GRANT EXECUTE ON FUNCTION public.dry_run_sst_link_readiness() TO authenticated;

COMMENT ON FUNCTION public.dry_run_sst_link_readiness() IS
  'Fase 0A · Diagnóstico read-only de SST e vínculos. Restrito a admin/manager. Sem DML.';
