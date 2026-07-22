
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

  -- 1) DOCUMENT TYPES
  WITH dt AS (
    SELECT id, code,
      public.f_normalize_nr_code(code) AS normalized_code,
      name, category, is_active, storage_scope,
      has_expiration, default_validity_days, created_at, updated_at,
      CASE
        WHEN has_expiration=false AND default_validity_days IS NULL     THEN 'inferred_no_expiry'
        WHEN has_expiration=true  AND default_validity_days > 0         THEN 'inferred_fixed_duration'
        WHEN has_expiration=true  AND default_validity_days IS NULL     THEN 'inferred_explicit_date'
        WHEN has_expiration=false AND default_validity_days IS NOT NULL THEN 'ambiguous_configuration'
        ELSE 'unknown'
      END AS inferred_policy
    FROM public.document_types WHERE category IN ('sst_nr','sst_aso','training')
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(dt) ORDER BY category, code),'[]'::jsonb)
  INTO v_document_types FROM dt;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(v_document_types) x
      WHERE x->>'inferred_policy' = 'ambiguous_configuration') > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code','document_validity_configuration_ambiguous','severity','critical',
      'count',(SELECT COUNT(*) FROM jsonb_array_elements(v_document_types) x
               WHERE x->>'inferred_policy'='ambiguous_configuration'),
      'description','document_types com has_expiration=false porém default_validity_days não nulo',
      'sample_ids',(SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(v_document_types) x
                    WHERE x->>'inferred_policy'='ambiguous_configuration'));
  END IF;

  -- 2) QUALIFICAÇÕES SST
  DECLARE
    r_total int; r_current int; r_hist int;
    r_with_exp int; r_without_exp int;
    r_with_cert int; r_without_cert int;
    r_no_dt int;
    r_by_type jsonb; r_by_nr jsonb; r_by_val jsonb;
    r_raw_var jsonb; r_display jsonb;
    r_true_mm_ids jsonb; r_true_mm_items jsonb; r_true_mm_c int;
    r_no_dt_ids jsonb;
    r_dup_items jsonb; r_dup_c int;
  BEGIN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE deleted_at IS NULL AND superseded_at IS NULL),
           COUNT(*) FILTER (WHERE superseded_at IS NOT NULL),
           COUNT(*) FILTER (WHERE expires_at IS NOT NULL),
           COUNT(*) FILTER (WHERE expires_at IS NULL),
           COUNT(*) FILTER (WHERE certificate_file_path IS NOT NULL),
           COUNT(*) FILTER (WHERE certificate_file_path IS NULL),
           COUNT(*) FILTER (WHERE document_type_id IS NULL)
    INTO r_total, r_current, r_hist, r_with_exp, r_without_exp,
         r_with_cert, r_without_cert, r_no_dt
    FROM public.worker_sst_qualifications;

    SELECT jsonb_agg(jsonb_build_object('document_type_id', document_type_id,'code', code,'count', c) ORDER BY c DESC)
      INTO r_by_type FROM (
        SELECT q.document_type_id, MAX(dt.code) AS code, COUNT(*) c
        FROM public.worker_sst_qualifications q
        LEFT JOIN public.document_types dt ON dt.id=q.document_type_id
        WHERE q.document_type_id IS NOT NULL
        GROUP BY q.document_type_id) t;

    SELECT jsonb_agg(jsonb_build_object('nr_code',nr_code,'count',c) ORDER BY c DESC)
      INTO r_by_nr FROM (SELECT nr_code, COUNT(*) c FROM public.worker_sst_qualifications GROUP BY nr_code) t;

    SELECT jsonb_agg(jsonb_build_object('validity_status',validity_status,'count',c))
      INTO r_by_val FROM (SELECT validity_status, COUNT(*) c FROM public.worker_sst_qualifications GROUP BY validity_status) t;

    SELECT jsonb_agg(jsonb_build_object('nr_code',nr_code,'count',c) ORDER BY c DESC)
      INTO r_raw_var FROM (SELECT nr_code, COUNT(*) c FROM public.worker_sst_qualifications GROUP BY nr_code) t;

    SELECT jsonb_agg(jsonb_build_object(
      'document_type_id',document_type_id,'canonical_code',dt_code,
      'raw_nr_code',nr_code,'count',c) ORDER BY c DESC)
      INTO r_display FROM (
        SELECT q.document_type_id, MAX(dt.code) dt_code, q.nr_code, COUNT(*) c
        FROM public.worker_sst_qualifications q
        JOIN public.document_types dt ON dt.id=q.document_type_id
        WHERE q.nr_code IS DISTINCT FROM dt.code
          AND public.f_normalize_nr_code(q.nr_code) = public.f_normalize_nr_code(dt.code)
        GROUP BY q.document_type_id, q.nr_code) t;

    SELECT COUNT(*), jsonb_agg(id), jsonb_agg(jsonb_build_object(
      'qualification_id',id,'worker_id',worker_id,'document_type_id',document_type_id,
      'canonical_code',dt_code,'raw_nr_code',nr_code))
    INTO r_true_mm_c, r_true_mm_ids, r_true_mm_items
    FROM (
      SELECT q.id, q.worker_id, q.document_type_id, dt.code AS dt_code, q.nr_code
      FROM public.worker_sst_qualifications q
      LEFT JOIN public.document_types dt ON dt.id=q.document_type_id
      WHERE q.document_type_id IS NOT NULL AND q.deleted_at IS NULL
        AND (dt.code IS NULL
             OR public.f_normalize_nr_code(q.nr_code) IS DISTINCT FROM public.f_normalize_nr_code(dt.code))
    ) t;

    SELECT jsonb_agg(id) INTO r_no_dt_ids FROM public.worker_sst_qualifications
     WHERE document_type_id IS NULL AND deleted_at IS NULL;

    SELECT COUNT(*), jsonb_agg(jsonb_build_object('worker_id',worker_id,'document_type_id',document_type_id,'count',c))
    INTO r_dup_c, r_dup_items FROM (
      SELECT worker_id, document_type_id, COUNT(*) c FROM public.worker_sst_qualifications
      WHERE deleted_at IS NULL AND superseded_at IS NULL AND document_type_id IS NOT NULL
      GROUP BY worker_id, document_type_id HAVING COUNT(*)>1) t;

    v_qual_integrity := jsonb_build_object(
      'totals', jsonb_build_object(
        'total',r_total,'current_active',r_current,'historical',r_hist,
        'with_expiry',r_with_exp,'without_expiry',r_without_exp,
        'with_certificate',r_with_cert,'without_certificate',r_without_cert,
        'without_document_type_id',r_no_dt),
      'by_document_type', COALESCE(r_by_type,'[]'::jsonb),
      'by_nr_code', COALESCE(r_by_nr,'[]'::jsonb),
      'by_validity_status', COALESCE(r_by_val,'[]'::jsonb),
      'raw_variants', COALESCE(r_raw_var,'[]'::jsonb),
      'display_variants', COALESCE(r_display,'[]'::jsonb),
      'true_mismatches', jsonb_build_object('count',COALESCE(r_true_mm_c,0),
        'sample_ids',COALESCE(r_true_mm_ids,'[]'::jsonb),
        'items',COALESCE(r_true_mm_items,'[]'::jsonb)),
      'without_document_type_id', jsonb_build_object('count',r_no_dt,
        'sample_ids',COALESCE(r_no_dt_ids,'[]'::jsonb)),
      'current_duplicates', jsonb_build_object('clusters',COALESCE(r_dup_c,0),
        'items',COALESCE(r_dup_items,'[]'::jsonb))
    );

    IF r_true_mm_c > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','qualification_true_code_mismatch',
        'severity','critical','count',r_true_mm_c,
        'description','document_type_id e nr_code normalizado divergem',
        'sample_ids',COALESCE(r_true_mm_ids,'[]'::jsonb));
    END IF;
    IF r_no_dt > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','qualification_without_document_type_id',
        'severity','critical','count',r_no_dt,
        'description','Qualificação sem document_type_id',
        'sample_ids',COALESCE(r_no_dt_ids,'[]'::jsonb));
    END IF;
    IF COALESCE(r_dup_c,0) > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','duplicate_current_worker_document_type',
        'severity','critical','count',r_dup_c,
        'description','Mesmo worker_id + document_type_id ativo em mais de uma revisão',
        'sample_ids','[]'::jsonb);
    END IF;
  END;

  -- 3) IDENTIDADE
  v_identity := jsonb_build_object(
    'primary_identity','worker_id + document_type_id',
    'chain_key_expression','CASE revision_type=additional -> nr_code||":"||id ELSE nr_code',
    'chain_key_uses_text', true,
    'unique_index_active','uq_sst_qual_worker_type_issued_active',
    'legacy_text_dependencies', jsonb_build_array(
      'worker_sst_qualifications.chain_key (generated from nr_code)',
      'idx_sst_worker_nr (worker_id, nr_code)',
      'idx_sst_nr_code (nr_code)'),
    'frontend_still_sending_nr_code', jsonb_build_array(
      'src/components/workers/sst/SstCertificateDrawer.tsx',
      'src/components/sst/AddSstDialog.tsx',
      'src/components/sst/NrValidityDialog.tsx',
      'src/components/sst/SstRenewDialog.tsx'),
    'display_only_fields', jsonb_build_array('nr_code (compat/display)'),
    'register_rpc','public.register_sst_revision'
  );
  v_blockers := v_blockers || jsonb_build_object('code','chain_identity_uses_text',
    'severity','warning','count',1,
    'description','chain_key gerada a partir de nr_code textual',
    'sample_ids','[]'::jsonb);

  -- 4) FLUXOS ASO / TREINAMENTO
  DECLARE aso_c int; tr_c int;
  BEGIN
    SELECT COUNT(*) INTO aso_c FROM public.worker_sst_qualifications q
      JOIN public.document_types dt ON dt.id=q.document_type_id
      WHERE dt.category='sst_aso' AND q.deleted_at IS NULL AND q.superseded_at IS NULL;
    SELECT COUNT(*) INTO tr_c FROM public.worker_sst_qualifications q
      JOIN public.document_types dt ON dt.id=q.document_type_id
      WHERE dt.category='training' AND q.deleted_at IS NULL AND q.superseded_at IS NULL;
    v_flows := jsonb_build_object(
      'aso_storage_flow', jsonb_build_object(
        'primary_table','public.worker_documents',
        'sst_master_table','public.worker_sst_qualifications',
        'creator_rpc','register_sst_revision (category=sst_aso)',
        'immutable_history',true,'uses_document_type_id',true,
        'auto_calculates_expires_at',false,
        'allows_manual_divergent_validity',true,
        'resolver_reusable_for_q014',true,
        'current_coverage',aso_c),
      'training_storage_flow', jsonb_build_object(
        'primary_table','public.worker_documents',
        'sst_master_table','public.worker_sst_qualifications',
        'creator_rpc','register_sst_revision (category=training)',
        'immutable_history',true,'uses_document_type_id',true,
        'auto_calculates_expires_at',false,
        'allows_manual_divergent_validity',true,
        'resolver_reusable_for_q014',true,
        'current_coverage',tr_c),
      'gaps_for_q014', jsonb_build_array(
        'ASO ainda não força política do document_type',
        'Treinamentos ainda não calculam expires_at por regra do tipo',
        'Frontend permite validade manual divergente')
    );
    IF aso_c = 0 THEN v_blockers := v_blockers || jsonb_build_object(
      'code','aso_flow_not_covered','severity','warning','count',1,
      'description','Nenhuma qualificação corrente de ASO','sample_ids','[]'::jsonb); END IF;
    IF tr_c = 0 THEN v_blockers := v_blockers || jsonb_build_object(
      'code','training_flow_not_covered','severity','warning','count',1,
      'description','Nenhuma qualificação corrente de treinamento','sample_ids','[]'::jsonb); END IF;
  END;

  -- 5) REQUISITOS
  DECLARE
    tt int; tt_ovr int; tt_eq int; tt_short int; tt_long int; tt_no_def int;
    tt_ract int; tt_rina int; dup_c int; dup_v jsonb; by_role jsonb; by_type jsonb;
  BEGIN
    WITH r AS (
      SELECT r.*, jr.is_active AS role_active, dt.default_validity_days AS dt_default
      FROM public.job_role_document_requirements r
      LEFT JOIN public.job_roles jr ON jr.id=r.job_role_id
      LEFT JOIN public.document_types dt ON dt.id=r.document_type_id
    )
    SELECT COUNT(*), COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL),
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND validity_days_override=dt_default),
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND dt_default IS NOT NULL AND validity_days_override<dt_default),
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND dt_default IS NOT NULL AND validity_days_override>dt_default),
      COUNT(*) FILTER (WHERE validity_days_override IS NOT NULL AND dt_default IS NULL),
      COUNT(*) FILTER (WHERE role_active=true), COUNT(*) FILTER (WHERE role_active=false)
    INTO tt,tt_ovr,tt_eq,tt_short,tt_long,tt_no_def,tt_ract,tt_rina FROM r;

    SELECT jsonb_agg(jsonb_build_object('job_role_id',job_role_id,'count',c) ORDER BY c DESC)
      INTO by_role FROM (SELECT job_role_id, COUNT(*) c FROM public.job_role_document_requirements GROUP BY job_role_id) t;
    SELECT jsonb_agg(jsonb_build_object('document_type_id',document_type_id,'count',c) ORDER BY c DESC)
      INTO by_type FROM (SELECT document_type_id, COUNT(*) c FROM public.job_role_document_requirements GROUP BY document_type_id) t;
    SELECT COUNT(*), jsonb_agg(jsonb_build_object('job_role_id',job_role_id,'document_type_id',document_type_id,'count',c))
      INTO dup_c, dup_v FROM (
        SELECT job_role_id, document_type_id, COUNT(*) c FROM public.job_role_document_requirements
        GROUP BY job_role_id, document_type_id HAVING COUNT(*)>1) t;

    v_requirements := jsonb_build_object(
      'totals', jsonb_build_object('total',tt,'with_override',tt_ovr,
        'override_equals_default',tt_eq,'override_shorter',tt_short,'override_longer',tt_long,
        'override_without_default',tt_no_def,'in_active_roles',tt_ract,'in_inactive_roles',tt_rina),
      'by_role', COALESCE(by_role,'[]'::jsonb),
      'by_document_type', COALESCE(by_type,'[]'::jsonb),
      'duplicates', jsonb_build_object('count',COALESCE(dup_c,0),'items',COALESCE(dup_v,'[]'::jsonb))
    );
    IF tt_rina > 0 THEN v_blockers := v_blockers || jsonb_build_object(
      'code','inactive_type_in_active_requirement','severity','warning','count',tt_rina,
      'description','Requisitos vinculados a cargos inativos','sample_ids','[]'::jsonb); END IF;
    IF COALESCE(dup_c,0) > 0 THEN v_blockers := v_blockers || jsonb_build_object(
      'code','duplicate_job_role_requirement','severity','critical','count',dup_c,
      'description','Mesmo job_role_id + document_type_id repetido','sample_ids','[]'::jsonb); END IF;
  END;

  -- 6) FONTES DE EVENTO
  DECLARE
    ev_nrs_c int; matched_c int; unmatched_c int; other_c int;
    distinct_v jsonb; unmatched_v jsonb;
  BEGIN
    WITH ev AS (
      SELECT id, required_nrs, required_nrs_other FROM public.events WHERE deleted_at IS NULL
    ), ev_nrs AS (
      SELECT id, unnest(required_nrs) AS raw_code FROM ev WHERE array_length(required_nrs,1) > 0
    ), matched AS (
      SELECT n.id, n.raw_code, dt.id AS document_type_id
      FROM ev_nrs n
      LEFT JOIN public.document_types dt
        ON public.f_normalize_nr_code(dt.code)=public.f_normalize_nr_code(n.raw_code)
       AND dt.category='sst_nr'
    )
    SELECT (SELECT COUNT(*) FROM ev_nrs),
           (SELECT COUNT(*) FROM matched WHERE document_type_id IS NOT NULL),
           (SELECT COUNT(*) FROM matched WHERE document_type_id IS NULL),
           (SELECT COUNT(*) FROM ev WHERE COALESCE(TRIM(required_nrs_other),'')<>''),
           (SELECT jsonb_agg(DISTINCT raw_code) FROM ev_nrs),
           (SELECT jsonb_agg(jsonb_build_object('event_id',id,'raw_code',raw_code)) FROM matched WHERE document_type_id IS NULL)
    INTO ev_nrs_c, matched_c, unmatched_c, other_c, distinct_v, unmatched_v;

    v_event_sources := jsonb_build_object('sources', jsonb_build_array(
      jsonb_build_object('table','public.events','field','required_nrs','type','text[]',
        'quantity',ev_nrs_c,'distinct_values',COALESCE(distinct_v,'[]'::jsonb),
        'normalizable',matched_c,'unmatched_count',unmatched_c,
        'unmatched_items',COALESCE(unmatched_v,'[]'::jsonb),
        'in_evaluate_link_compliance',true,
        'canonicalization_proposal','Migrar para event_document_requirements(document_type_id)'),
      jsonb_build_object('table','public.events','field','required_nrs_other','type','text',
        'quantity',other_c,'distinct_values','[]'::jsonb,'normalizable',0,
        'unmatched_count',other_c,'unmatched_items','[]'::jsonb,
        'in_evaluate_link_compliance',false,
        'canonicalization_proposal','Descontinuar texto livre'),
      jsonb_build_object('table','public.employment_link_document_overrides','field','(document_type_id)',
        'type','FK',
        'quantity',(SELECT COUNT(*) FROM public.employment_link_document_overrides WHERE deleted_at IS NULL),
        'distinct_values','[]'::jsonb,'normalizable',0,'unmatched_count',0,
        'unmatched_items','[]'::jsonb,'in_evaluate_link_compliance',true,
        'canonicalization_proposal','Já canônico via document_type_id')
    ));
    IF (unmatched_c + other_c) > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','event_requirement_not_canonical',
        'severity','critical','count',unmatched_c+other_c,
        'description','events.required_nrs/required_nrs_other dependem de texto livre',
        'sample_ids','[]'::jsonb);
    END IF;
  END;

  -- 7) OVERRIDES
  SELECT jsonb_build_object(
    'total',COUNT(*),
    'active',COUNT(*) FILTER (WHERE deleted_at IS NULL),
    'deleted',COUNT(*) FILTER (WHERE deleted_at IS NOT NULL),
    'add',COUNT(*) FILTER (WHERE action='add' AND deleted_at IS NULL),
    'waive',COUNT(*) FILTER (WHERE action='waive' AND deleted_at IS NULL),
    'with_required_until',COUNT(*) FILTER (WHERE required_until IS NOT NULL AND deleted_at IS NULL),
    'inactive_type_referenced',COUNT(*) FILTER (WHERE dt.is_active=false AND o.deleted_at IS NULL),
    'historical_link_referenced',COUNT(*) FILTER (WHERE l.deleted_at IS NOT NULL),
    'uses_document_type_id',true)
  INTO v_overrides
  FROM public.employment_link_document_overrides o
  LEFT JOIN public.document_types dt ON dt.id=o.document_type_id
  LEFT JOIN public.employment_links l ON l.id=o.employment_link_id;

  -- 8) VÍNCULOS
  DECLARE
    c_nd int; c_vig int; c_sa int; c_sav int; c_end int; c_fut int;
    c_nod int; c_ee int; c_ef int; by_status_v jsonb; multi_v jsonb; multi_c int;
  BEGIN
    WITH el AS (
      SELECT l.*, e.start_date AS event_start, e.end_date AS event_end
      FROM public.employment_links l LEFT JOIN public.events e ON e.id=l.event_id
    )
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND (hire_date IS NULL OR hire_date<=CURRENT_DATE) AND (end_date IS NULL OR end_date>=CURRENT_DATE)),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='active'),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='active' AND (hire_date IS NULL OR hire_date<=CURRENT_DATE) AND (end_date IS NULL OR end_date>=CURRENT_DATE)),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date IS NOT NULL AND end_date<CURRENT_DATE),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND hire_date IS NOT NULL AND hire_date>CURRENT_DATE),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND hire_date IS NULL AND end_date IS NULL),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND event_end IS NOT NULL AND event_end<CURRENT_DATE),
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND event_start IS NOT NULL AND event_start>CURRENT_DATE)
    INTO c_nd,c_vig,c_sa,c_sav,c_end,c_fut,c_nod,c_ee,c_ef FROM el;

    SELECT jsonb_agg(jsonb_build_object('status',status,'count',c))
      INTO by_status_v FROM (SELECT status, COUNT(*) c FROM public.employment_links
      WHERE deleted_at IS NULL GROUP BY status) t;

    SELECT COUNT(*), jsonb_agg(jsonb_build_object(
      'worker_id',w.id,'worker_name',w.full_name,'active_links_count',m.c,
      'links',(SELECT jsonb_agg(jsonb_build_object(
        'employment_link_id',l.id,'event_id',l.event_id,'event_name',ev.name,
        'job_role_id',l.job_role_id,'job_role_name',jr.name,
        'link_status',l.status,'hire_date',l.hire_date,'end_date',l.end_date,
        'requirements_count',(SELECT COUNT(*) FROM public.job_role_document_requirements WHERE job_role_id=l.job_role_id),
        'overrides_count',(SELECT COUNT(*) FROM public.employment_link_document_overrides
                            WHERE employment_link_id=l.id AND deleted_at IS NULL)))
        FROM public.employment_links l
        LEFT JOIN public.events ev ON ev.id=l.event_id
        LEFT JOIN public.job_roles jr ON jr.id=l.job_role_id
        WHERE l.worker_id=m.worker_id AND l.deleted_at IS NULL AND l.status='active')))
    INTO multi_c, multi_v FROM (
      SELECT worker_id, COUNT(*) c FROM public.employment_links
      WHERE deleted_at IS NULL AND status='active'
      GROUP BY worker_id HAVING COUNT(*)>1) m
    JOIN public.workers w ON w.id=m.worker_id;

    v_link_status := jsonb_build_object(
      'not_deleted',c_nd,'vigent_by_dates',c_vig,'status_active',c_sa,
      'status_active_and_vigent',c_sav,'ended_by_date',c_end,'future',c_fut,
      'no_dates',c_nod,'event_ended',c_ee,'event_future',c_ef,
      'by_status',COALESCE(by_status_v,'[]'::jsonb));
    v_multi_link := jsonb_build_object(
      'criterion','status=active AND deleted_at IS NULL',
      'worker_count',COALESCE(multi_c,0),
      'items',COALESCE(multi_v,'[]'::jsonb));
  END;

  v_blockers := v_blockers || jsonb_build_object('code','unresolved_multi_link_status_definition',
    'severity','warning','count',1,
    'description','Definição oficial de vínculo corrente pendente','sample_ids','[]'::jsonb);

  -- 9) VALIDADE POR VÍNCULO
  DECLARE
    v_shared int; v_ovr_long int; v_ovr_short int;
    v_no_exp int; v_no_rule int; v_a_ok_b_bad int;
  BEGIN
    WITH cur AS (
      SELECT worker_id, document_type_id, expires_at, issued_at, id AS qual_id
      FROM public.worker_sst_qualifications
      WHERE deleted_at IS NULL AND superseded_at IS NULL
    ), reqs AS (
      SELECT l.id AS link_id, l.worker_id, r.document_type_id, r.validity_days_override
      FROM public.employment_links l
      JOIN public.job_role_document_requirements r ON r.job_role_id=l.job_role_id
      WHERE l.deleted_at IS NULL
    ), eff AS (
      SELECT reqs.link_id, cur.qual_id, cur.expires_at AS certificate_expiry,
             reqs.validity_days_override,
             CASE WHEN reqs.validity_days_override IS NOT NULL AND cur.issued_at IS NOT NULL
                  THEN cur.issued_at + reqs.validity_days_override END AS role_effective_expiry
      FROM reqs LEFT JOIN cur ON cur.worker_id=reqs.worker_id AND cur.document_type_id=reqs.document_type_id
    )
    SELECT
      (SELECT COUNT(*) FROM (SELECT qual_id FROM eff WHERE qual_id IS NOT NULL GROUP BY qual_id HAVING COUNT(DISTINCT link_id)>1) s),
      (SELECT COUNT(*) FROM eff WHERE role_effective_expiry IS NOT NULL AND certificate_expiry IS NOT NULL AND role_effective_expiry>certificate_expiry),
      (SELECT COUNT(*) FROM eff WHERE role_effective_expiry IS NOT NULL AND certificate_expiry IS NOT NULL AND role_effective_expiry<certificate_expiry),
      (SELECT COUNT(*) FROM eff WHERE certificate_expiry IS NULL),
      (SELECT COUNT(*) FROM eff WHERE validity_days_override IS NULL),
      (SELECT COUNT(*) FROM eff WHERE role_effective_expiry IS NOT NULL AND role_effective_expiry<CURRENT_DATE AND certificate_expiry IS NOT NULL AND certificate_expiry>=CURRENT_DATE)
    INTO v_shared, v_ovr_long, v_ovr_short, v_no_exp, v_no_rule, v_a_ok_b_bad;

    v_validity := jsonb_build_object(
      'shared_certificates_multiple_links',v_shared,
      'override_longer_than_certificate',v_ovr_long,
      'override_shorter_than_certificate',v_ovr_short,
      'certificate_without_expiry',v_no_exp,
      'requirement_without_validity_rule',v_no_rule,
      'valid_on_a_expired_on_b_by_override',v_a_ok_b_bad);
  END;

  -- 10) PRESERVAÇÃO
  SELECT jsonb_build_object(
    'group_worker_counts', COALESCE(jsonb_agg(to_jsonb(gc.*) ORDER BY event_name, group_name),'[]'::jsonb),
    'expected_rock_in_rio', 56,
    'expected_shakira', 29,
    'worker_sst_qualifications_total',(SELECT COUNT(*) FROM public.worker_sst_qualifications),
    'worker_sst_qualifications_current',(SELECT COUNT(*) FROM public.worker_sst_qualifications WHERE deleted_at IS NULL AND superseded_at IS NULL),
    'worker_sst_qualifications_history',(SELECT COUNT(*) FROM public.worker_sst_qualifications WHERE superseded_at IS NOT NULL),
    'worker_documents_total',(SELECT COUNT(*) FROM public.worker_documents),
    'employment_links_total',(SELECT COUNT(*) FROM public.employment_links WHERE deleted_at IS NULL),
    'link_group_workers_total',(SELECT COUNT(*) FROM public.link_group_workers WHERE deleted_at IS NULL),
    'job_role_requirements_total',(SELECT COUNT(*) FROM public.job_role_document_requirements),
    'overrides_total',(SELECT COUNT(*) FROM public.employment_link_document_overrides WHERE deleted_at IS NULL))
  INTO v_preservation
  FROM (
    SELECT lg.id AS link_group_id, lg.event_id, lg.group_name, e.name AS event_name,
           COUNT(lgw.*) AS total,
           COUNT(lgw.*) FILTER (WHERE lgw.deleted_at IS NULL) AS not_deleted,
           COUNT(lgw.*) FILTER (WHERE lgw.deleted_at IS NULL AND lgw.status='active') AS status_active,
           COUNT(lgw.*) FILTER (WHERE lgw.deleted_at IS NULL AND (lgw.hire_date IS NULL OR lgw.hire_date<=CURRENT_DATE) AND (lgw.end_date IS NULL OR lgw.end_date>=CURRENT_DATE)) AS vigent
    FROM public.link_groups lg
    LEFT JOIN public.events e ON e.id=lg.event_id
    LEFT JOIN public.link_group_workers lgw ON lgw.link_group_id=lg.id
    WHERE lg.deleted_at IS NULL
    GROUP BY lg.id, lg.event_id, lg.group_name, e.name
  ) gc;

  -- SUMMARY
  v_summary := jsonb_build_object(
    'document_types_total', jsonb_array_length(v_document_types),
    'qualifications_total',(v_qual_integrity->'totals'->>'total')::int,
    'qualifications_current',(v_qual_integrity->'totals'->>'current_active')::int,
    'requirements_total',(v_requirements->'totals'->>'total')::int,
    'overrides_active',(v_overrides->>'active')::int,
    'employment_links_not_deleted',(v_link_status->>'not_deleted')::int,
    'multi_link_active_workers',(v_multi_link->>'worker_count')::int,
    'blockers_count', jsonb_array_length(v_blockers));

  v_report := jsonb_build_object(
    'schema_version',1,'generated_at',now(),
    'strategy', jsonb_build_object('phase','0A','read_only',true,'no_dml',true,
      'notes','Diagnóstico integral SST + vínculos. Nenhuma tabela operacional foi alterada.'),
    'summary',v_summary,
    'document_types',v_document_types,
    'qualification_integrity',v_qual_integrity,
    'identity',v_identity,
    'flows',v_flows,
    'requirements',v_requirements,
    'event_requirement_sources',v_event_sources,
    'overrides',v_overrides,
    'link_status_distribution',v_link_status,
    'multi_link_workers',v_multi_link,
    'per_link_validity_simulation',v_validity,
    'preservation_baseline',v_preservation,
    'blockers',v_blockers);

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.dry_run_sst_link_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dry_run_sst_link_readiness() FROM anon;
GRANT EXECUTE ON FUNCTION public.dry_run_sst_link_readiness() TO authenticated;
