CREATE OR REPLACE FUNCTION public.evaluate_link_compliance(p_link_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link record;
  v_worker record;
  v_role record;
  v_event record;
  v_warning_days int := 30;
  v_docs jsonb;
  v_overall_calc jsonb;
  v_required_by_sources jsonb;
  v_has_link_override boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT el.id, el.worker_id, el.job_role_id, el.event_id, el.end_date
    INTO v_link FROM public.employment_links el WHERE el.id = p_link_id;

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 2, 'error','link_not_found');
  END IF;

  SELECT w.id, w.full_name AS name INTO v_worker FROM public.workers w WHERE w.id = v_link.worker_id;
  SELECT jr.id, jr.name INTO v_role FROM public.job_roles jr WHERE jr.id = v_link.job_role_id;
  IF v_link.event_id IS NOT NULL THEN
    SELECT e.id, e.name INTO v_event FROM public.events e WHERE e.id = v_link.event_id;
  END IF;

  WITH overrides AS (
    SELECT o.document_type_id, o.action::text AS action, o.required_until
      FROM public.employment_link_document_overrides o
     WHERE o.employment_link_id = v_link.id AND o.deleted_at IS NULL
  ),
  base_reqs AS (
    SELECT r.document_type_id, dt.code, dt.name, dt.category,
      dt.has_expiration, dt.requires_file, dt.default_validity_days,
      r.is_mandatory, r.validity_days_override, r.display_order,
      COALESCE(r.required_by,'job_role') AS required_by,
      NULL::date AS required_until,
      NULL::text  AS override_action
    FROM public.job_role_document_requirements r
    JOIN public.document_types dt ON dt.id = r.document_type_id
   WHERE r.job_role_id = v_link.job_role_id AND dt.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM overrides ov
        WHERE ov.document_type_id = r.document_type_id AND ov.action = 'waive'
     )
  ),
  add_reqs AS (
    SELECT ov.document_type_id, dt.code, dt.name, dt.category,
      dt.has_expiration, dt.requires_file, dt.default_validity_days,
      true AS is_mandatory, NULL::int AS validity_days_override,
      9999 AS display_order, 'link_override'::text AS required_by,
      ov.required_until, 'add'::text AS override_action
    FROM overrides ov
    JOIN public.document_types dt ON dt.id = ov.document_type_id
   WHERE ov.action = 'add' AND dt.is_active = true
     AND (ov.required_until IS NULL OR ov.required_until >= CURRENT_DATE)
  ),
  reqs AS (
    SELECT * FROM base_reqs
    UNION ALL
    SELECT * FROM add_reqs
     WHERE document_type_id NOT IN (SELECT document_type_id FROM base_reqs)
  ),
  latest_wd AS (
    SELECT DISTINCT ON (wd.document_type_id)
      wd.id AS worker_document_id, wd.document_type_id,
      wd.expiry_date, wd.issue_date, wd.status AS wd_status, wd.file_path
    FROM public.worker_documents wd
   WHERE wd.worker_id = v_link.worker_id
     AND wd.deleted_at IS NULL AND wd.document_type_id IS NOT NULL
   ORDER BY wd.document_type_id, wd.issue_date DESC NULLS LAST, wd.created_at DESC
  ),
  latest_eld AS (
    SELECT DISTINCT ON (dt.id)
      eld.id AS worker_document_id, dt.id AS document_type_id,
      NULL::date AS expiry_date, eld.created_at::date AS issue_date,
      COALESCE(eld.status,'approved') AS wd_status, eld.file_path
    FROM public.employment_link_documents eld
    JOIN public.document_types dt
      ON lower(dt.code) = lower(COALESCE(eld.document_type,''))
     AND dt.category <> 'sst_nr'
   WHERE eld.employment_link_id = v_link.id
     AND eld.deleted_at IS NULL
   ORDER BY dt.id, eld.created_at DESC
  ),
  latest_nr AS (
    SELECT q.document_type_id,
           q.id AS worker_document_id,
           q.expires_at AS expiry_date,
           q.issued_at AS issue_date,
           'approved' AS wd_status,
           q.document_url AS file_path,
           q.validity_status AS nr_validity_status
      FROM public.worker_sst_qualifications_current q
     WHERE q.worker_id = v_link.worker_id
  ),
  merged_docs AS (
    SELECT r.*, n.worker_document_id, n.expiry_date, n.issue_date,
           n.wd_status, n.file_path, n.nr_validity_status
      FROM reqs r
      LEFT JOIN latest_nr n ON n.document_type_id = r.document_type_id
     WHERE r.category = 'sst_nr'
    UNION ALL
    SELECT r.*,
           COALESCE(wd.worker_document_id, eld.worker_document_id) AS worker_document_id,
           COALESCE(wd.expiry_date, eld.expiry_date) AS expiry_date,
           COALESCE(wd.issue_date, eld.issue_date) AS issue_date,
           COALESCE(wd.wd_status, eld.wd_status) AS wd_status,
           COALESCE(wd.file_path, eld.file_path) AS file_path,
           NULL::text AS nr_validity_status
      FROM reqs r
      LEFT JOIN latest_wd wd ON wd.document_type_id = r.document_type_id
      LEFT JOIN latest_eld eld ON eld.document_type_id = r.document_type_id
     WHERE r.category <> 'sst_nr'
  ),
  evaluated AS (SELECT * FROM merged_docs),
  scored AS (
    SELECT e.*,
      CASE
        WHEN e.category='sst_nr' THEN
          CASE
            WHEN e.worker_document_id IS NULL THEN NULL
            WHEN e.nr_validity_status = 'no_expiry' THEN NULL
            WHEN e.expiry_date IS NULL THEN NULL
            ELSE (e.expiry_date - CURRENT_DATE)
          END
        ELSE
          CASE WHEN e.expiry_date IS NOT NULL THEN (e.expiry_date - CURRENT_DATE) ELSE NULL END
      END AS days_remaining,
      CASE
        WHEN e.worker_document_id IS NULL THEN 'missing'
        WHEN e.category='sst_nr' THEN
          CASE
            WHEN e.nr_validity_status = 'unknown' THEN 'pending'
            WHEN e.expiry_date IS NOT NULL AND e.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN e.wd_status = 'pending' THEN 'pending'
            WHEN e.expiry_date IS NOT NULL
                 AND e.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        ELSE
          CASE
            WHEN e.has_expiration AND e.expiry_date IS NOT NULL AND e.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN e.wd_status = 'pending' THEN 'pending'
            WHEN e.requires_file AND (e.file_path IS NULL OR e.file_path='') THEN 'pending'
            WHEN e.has_expiration AND e.expiry_date IS NOT NULL
                 AND e.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
      END AS status
    FROM evaluated e
  ),
  labeled AS (
    SELECT s.*,
      CASE s.status
        WHEN 'missing' THEN 'Não possui' WHEN 'expired' THEN 'Vencido'
        WHEN 'pending' THEN 'Pendente'  WHEN 'warning' THEN 'Vencendo'
        WHEN 'ok'      THEN 'Válido'
      END AS status_label,
      CASE s.status
        WHEN 'missing' THEN
          CASE WHEN s.is_mandatory THEN 'Documento obrigatório não encontrado'
               ELSE 'Documento opcional não anexado' END
        WHEN 'expired' THEN 'Documento vencido em ' || to_char(s.expiry_date,'DD/MM/YYYY')
        WHEN 'pending' THEN
          CASE WHEN s.requires_file AND (s.file_path IS NULL OR s.file_path='')
               THEN 'Documento aguardando anexo'
               ELSE 'Documento pendente de validação' END
        WHEN 'warning' THEN 'Vence em ' || s.days_remaining || ' dia(s), em ' || to_char(s.expiry_date,'DD/MM/YYYY')
        WHEN 'ok' THEN
          CASE WHEN s.has_expiration AND s.expiry_date IS NOT NULL
               THEN 'Válido até ' || to_char(s.expiry_date,'DD/MM/YYYY')
               ELSE 'Documento válido' END
      END AS status_reason
    FROM scored s
  )
  SELECT jsonb_agg(
      jsonb_build_object(
        'document_type_id', document_type_id, 'code', code, 'name', name, 'category', category,
        'status', status, 'status_code', status,
        'status_label', status_label, 'status_reason', status_reason,
        'expires_at', expiry_date, 'days_remaining', days_remaining,
        'worker_document_id', worker_document_id,
        'is_mandatory', is_mandatory, 'required_by', required_by,
        'override_action', override_action,
        'display_order', display_order,
        'reason_params', jsonb_build_object(
          'expiry_date', expiry_date, 'days_remaining', days_remaining,
          'required_until', COALESCE(required_until, v_link.end_date),
          'link_start', NULL, 'link_end', v_link.end_date,
          'document_type_code', code
        )
      )
      ORDER BY
        CASE status WHEN 'missing' THEN 1 WHEN 'expired' THEN 2
                    WHEN 'pending' THEN 3 WHEN 'warning' THEN 4 WHEN 'ok' THEN 5 END,
        display_order, name
    )
  INTO v_docs FROM labeled;

  v_docs := COALESCE(v_docs, '[]'::jsonb);
  v_overall_calc := public.calculate_compliance_overall(v_docs);

  SELECT EXISTS (
    SELECT 1 FROM public.employment_link_document_overrides o
     WHERE o.employment_link_id = v_link.id AND o.deleted_at IS NULL
  ) INTO v_has_link_override;

  v_required_by_sources := '[]'::jsonb;
  IF v_role.id IS NOT NULL THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','job_role','id',v_role.id,'name',v_role.name));
  END IF;
  IF v_event.id IS NOT NULL THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','event','id',v_event.id,'name',v_event.name));
  END IF;
  IF v_has_link_override THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','link_override','id',v_link.id,'name','Exceção do vínculo'));
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 2,
    'overall', v_overall_calc->>'overall',
    'link_id', v_link.id,
    'job_role', CASE WHEN v_role.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', v_role.id, 'name', v_role.name) END,
    'worker', CASE WHEN v_worker.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', v_worker.id, 'name', v_worker.name) END,
    'event', CASE WHEN v_event.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', v_event.id, 'name', v_event.name) END,
    'score', v_overall_calc->'score',
    'documents', v_docs,
    'required_by_sources', v_required_by_sources
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.simulate_link_compliance(p_link_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link RECORD;
  v_worker RECORD;
  v_role RECORD;
  v_event RECORD;
  v_warning_days INT := 30;
  v_docs JSONB;
  v_overall_calc JSONB;
  v_required_by_sources jsonb;
  v_applied_overrides jsonb;
  v_has_link_override boolean := false;
  v_remove_req UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'remove_requirement_type_ids','[]'::jsonb)))::uuid);
  v_add_req JSONB := COALESCE(p_overrides->'add_requirements','[]'::jsonb);
  v_add_docs JSONB := COALESCE(p_overrides->'add_worker_documents','[]'::jsonb);
  v_remove_docs UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'remove_worker_document_ids','[]'::jsonb)))::uuid);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT el.id, el.worker_id, el.job_role_id, el.event_id, el.end_date
    INTO v_link FROM public.employment_links el WHERE el.id = p_link_id;
  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 2, 'error','link_not_found', 'simulated', true);
  END IF;

  SELECT w.id, w.full_name AS name INTO v_worker FROM public.workers w WHERE w.id = v_link.worker_id;
  SELECT jr.id, jr.name INTO v_role FROM public.job_roles jr WHERE jr.id = v_link.job_role_id;
  IF v_link.event_id IS NOT NULL THEN
    SELECT e.id, e.name INTO v_event FROM public.events e WHERE e.id = v_link.event_id;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object('id', o.id, 'document_type_id', o.document_type_id,
      'action', o.action, 'required_until', o.required_until, 'reason', o.reason)
  ) INTO v_applied_overrides
  FROM public.employment_link_document_overrides o
  WHERE o.employment_link_id = v_link.id AND o.deleted_at IS NULL;
  v_applied_overrides := COALESCE(v_applied_overrides, '[]'::jsonb);
  v_has_link_override := jsonb_array_length(v_applied_overrides) > 0;

  WITH overrides AS (
    SELECT o.document_type_id, o.action::text AS action, o.required_until
      FROM public.employment_link_document_overrides o
     WHERE o.employment_link_id = v_link.id AND o.deleted_at IS NULL
  ),
  base_reqs AS (
    SELECT r.document_type_id, dt.code, dt.name, dt.category,
           dt.has_expiration, dt.requires_file, dt.default_validity_days,
           r.is_mandatory, r.validity_days_override, r.display_order,
           COALESCE(r.required_by,'job_role') AS required_by,
           NULL::date AS required_until, NULL::text AS override_action
      FROM public.job_role_document_requirements r
      JOIN public.document_types dt ON dt.id = r.document_type_id
     WHERE r.job_role_id = v_link.job_role_id AND dt.is_active = true
       AND NOT (r.document_type_id = ANY(v_remove_req))
       AND NOT EXISTS (
         SELECT 1 FROM overrides ov
          WHERE ov.document_type_id = r.document_type_id AND ov.action = 'waive'
       )
  ),
  add_from_override AS (
    SELECT ov.document_type_id, dt.code, dt.name, dt.category,
           dt.has_expiration, dt.requires_file, dt.default_validity_days,
           true AS is_mandatory, NULL::int AS validity_days_override,
           9999 AS display_order, 'link_override'::text AS required_by,
           ov.required_until, 'add'::text AS override_action
      FROM overrides ov
      JOIN public.document_types dt ON dt.id = ov.document_type_id
     WHERE ov.action = 'add' AND dt.is_active = true
       AND (ov.required_until IS NULL OR ov.required_until >= CURRENT_DATE)
  ),
  extra_reqs AS (
    SELECT (a->>'document_type_id')::uuid AS document_type_id,
           dt.code, dt.name, dt.category, dt.has_expiration, dt.requires_file, dt.default_validity_days,
           COALESCE((a->>'is_mandatory')::boolean, true) AS is_mandatory,
           NULLIF(a->>'validity_days_override','')::int AS validity_days_override,
           COALESCE((a->>'display_order')::int, 9999) AS display_order,
           COALESCE(a->>'required_by','job_role') AS required_by,
           NULL::date AS required_until, NULL::text AS override_action
      FROM jsonb_array_elements(v_add_req) a
      JOIN public.document_types dt ON dt.id = (a->>'document_type_id')::uuid
     WHERE dt.is_active = true
  ),
  reqs AS (
    SELECT * FROM base_reqs
    UNION ALL
    SELECT * FROM add_from_override WHERE document_type_id NOT IN (SELECT document_type_id FROM base_reqs)
    UNION ALL
    SELECT * FROM extra_reqs
     WHERE document_type_id NOT IN (SELECT document_type_id FROM base_reqs)
       AND document_type_id NOT IN (SELECT document_type_id FROM add_from_override)
  ),
  base_wd AS (
    SELECT DISTINCT ON (wd.document_type_id)
      wd.id AS worker_document_id, wd.document_type_id,
      wd.expiry_date, wd.issue_date, wd.status AS wd_status, wd.file_path
    FROM public.worker_documents wd
   WHERE wd.worker_id = v_link.worker_id
     AND wd.deleted_at IS NULL AND wd.document_type_id IS NOT NULL
     AND NOT (wd.id = ANY(v_remove_docs))
   ORDER BY wd.document_type_id, wd.issue_date DESC NULLS LAST, wd.created_at DESC
  ),
  sim_docs AS (
    SELECT NULL::uuid AS worker_document_id,
           (a->>'document_type_id')::uuid AS document_type_id,
           NULLIF(a->>'expiry_date','')::date AS expiry_date,
           CURRENT_DATE AS issue_date,
           COALESCE(a->>'status','approved') AS wd_status,
           CASE WHEN COALESCE((a->>'has_file')::boolean, true) THEN 'simulated' ELSE NULL END AS file_path
      FROM jsonb_array_elements(v_add_docs) a
  ),
  latest_wd AS (
    SELECT * FROM base_wd
    UNION ALL
    SELECT * FROM sim_docs WHERE document_type_id NOT IN (SELECT document_type_id FROM base_wd)
  ),
  latest_eld AS (
    SELECT DISTINCT ON (dt.id)
      eld.id AS worker_document_id, dt.id AS document_type_id,
      NULL::date AS expiry_date, eld.created_at::date AS issue_date,
      COALESCE(eld.status,'approved') AS wd_status, eld.file_path
    FROM public.employment_link_documents eld
    JOIN public.document_types dt
      ON lower(dt.code) = lower(COALESCE(eld.document_type,''))
     AND dt.category <> 'sst_nr'
   WHERE eld.employment_link_id = v_link.id
     AND eld.deleted_at IS NULL
   ORDER BY dt.id, eld.created_at DESC
  ),
  latest_nr AS (
    SELECT q.document_type_id, q.id AS worker_document_id,
           q.expires_at AS expiry_date, q.issued_at AS issue_date,
           'approved' AS wd_status, q.document_url AS file_path,
           q.validity_status AS nr_validity_status
      FROM public.worker_sst_qualifications_current q
     WHERE q.worker_id = v_link.worker_id
  ),
  merged_docs AS (
    SELECT r.*, n.worker_document_id, n.expiry_date, n.issue_date,
           n.wd_status, n.file_path, n.nr_validity_status
      FROM reqs r
      LEFT JOIN latest_nr n ON n.document_type_id = r.document_type_id
     WHERE r.category = 'sst_nr'
    UNION ALL
    SELECT r.*,
           COALESCE(wd.worker_document_id, eld.worker_document_id) AS worker_document_id,
           COALESCE(wd.expiry_date, eld.expiry_date) AS expiry_date,
           COALESCE(wd.issue_date, eld.issue_date) AS issue_date,
           COALESCE(wd.wd_status, eld.wd_status) AS wd_status,
           COALESCE(wd.file_path, eld.file_path) AS file_path,
           NULL::text AS nr_validity_status
      FROM reqs r
      LEFT JOIN latest_wd wd ON wd.document_type_id = r.document_type_id
      LEFT JOIN latest_eld eld ON eld.document_type_id = r.document_type_id
     WHERE r.category <> 'sst_nr'
  ),
  evaluated AS (SELECT * FROM merged_docs),
  scored AS (
    SELECT e.*,
      CASE
        WHEN e.category='sst_nr' THEN
          CASE
            WHEN e.worker_document_id IS NULL THEN NULL
            WHEN e.nr_validity_status = 'no_expiry' THEN NULL
            WHEN e.expiry_date IS NULL THEN NULL
            ELSE (e.expiry_date - CURRENT_DATE)
          END
        ELSE
          CASE WHEN e.expiry_date IS NOT NULL THEN (e.expiry_date - CURRENT_DATE) ELSE NULL END
      END AS days_remaining,
      CASE
        WHEN e.worker_document_id IS NULL THEN 'missing'
        WHEN e.category='sst_nr' THEN
          CASE
            WHEN e.nr_validity_status = 'unknown' THEN 'pending'
            WHEN e.expiry_date IS NOT NULL AND e.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN e.wd_status = 'pending' THEN 'pending'
            WHEN e.expiry_date IS NOT NULL
                 AND e.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        ELSE
          CASE
            WHEN e.has_expiration AND e.expiry_date IS NOT NULL AND e.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN e.wd_status = 'pending' THEN 'pending'
            WHEN e.requires_file AND (e.file_path IS NULL OR e.file_path='') THEN 'pending'
            WHEN e.has_expiration AND e.expiry_date IS NOT NULL
                 AND e.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
      END AS status
    FROM evaluated e
  ),
  labeled AS (
    SELECT s.*,
      CASE s.status
        WHEN 'missing' THEN 'Não possui' WHEN 'expired' THEN 'Vencido'
        WHEN 'pending' THEN 'Pendente'  WHEN 'warning' THEN 'Vencendo'
        WHEN 'ok'      THEN 'Válido'
      END AS status_label,
      CASE s.status
        WHEN 'missing' THEN
          CASE WHEN s.is_mandatory THEN 'Documento obrigatório não encontrado'
               ELSE 'Documento opcional não anexado' END
        WHEN 'expired' THEN 'Documento vencido em ' || to_char(s.expiry_date,'DD/MM/YYYY')
        WHEN 'pending' THEN
          CASE WHEN s.requires_file AND (s.file_path IS NULL OR s.file_path='')
               THEN 'Documento aguardando anexo'
               ELSE 'Documento pendente de validação' END
        WHEN 'warning' THEN 'Vence em ' || s.days_remaining || ' dia(s), em ' || to_char(s.expiry_date,'DD/MM/YYYY')
        WHEN 'ok' THEN
          CASE WHEN s.has_expiration AND s.expiry_date IS NOT NULL
               THEN 'Válido até ' || to_char(s.expiry_date,'DD/MM/YYYY')
               ELSE 'Documento válido' END
      END AS status_reason
    FROM scored s
  )
  SELECT jsonb_agg(
      jsonb_build_object(
        'document_type_id', document_type_id, 'code', code, 'name', name, 'category', category,
        'status', status, 'status_code', status,
        'status_label', status_label, 'status_reason', status_reason,
        'expires_at', expiry_date, 'days_remaining', days_remaining,
        'worker_document_id', worker_document_id,
        'is_mandatory', is_mandatory, 'required_by', required_by,
        'override_action', override_action,
        'display_order', display_order,
        'reason_params', jsonb_build_object(
          'expiry_date', expiry_date, 'days_remaining', days_remaining,
          'required_until', COALESCE(required_until, v_link.end_date),
          'link_start', NULL, 'link_end', v_link.end_date,
          'document_type_code', code
        )
      )
      ORDER BY
        CASE status WHEN 'missing' THEN 1 WHEN 'expired' THEN 2
                    WHEN 'pending' THEN 3 WHEN 'warning' THEN 4 WHEN 'ok' THEN 5 END,
        display_order, name
    )
  INTO v_docs FROM labeled;

  v_docs := COALESCE(v_docs, '[]'::jsonb);
  v_overall_calc := public.calculate_compliance_overall(v_docs);

  v_required_by_sources := '[]'::jsonb;
  IF v_role.id IS NOT NULL THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','job_role','id',v_role.id,'name',v_role.name));
  END IF;
  IF v_event.id IS NOT NULL THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','event','id',v_event.id,'name',v_event.name));
  END IF;
  IF v_has_link_override THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','link_override','id',v_link.id,'name','Exceção do vínculo'));
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 2, 'simulated', true,
    'overall', v_overall_calc->>'overall',
    'link_id', v_link.id,
    'job_role', CASE WHEN v_role.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_role.id, 'name', v_role.name) END,
    'worker',   CASE WHEN v_worker.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_worker.id, 'name', v_worker.name) END,
    'event',    CASE WHEN v_event.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_event.id, 'name', v_event.name) END,
    'score', v_overall_calc->'score',
    'documents', v_docs,
    'required_by_sources', v_required_by_sources,
    'applied_overrides', v_applied_overrides
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.document_compliance_summary(p_warning_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_total_workers int;
  v_total_job_roles int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(*) INTO v_total_workers   FROM public.workers   WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO v_total_job_roles FROM public.job_roles WHERE is_active = true;

  WITH active_links AS (
    SELECT el.id, el.worker_id, el.job_role_id, jr.name AS job_role_name
      FROM public.employment_links el
      LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
     WHERE el.deleted_at IS NULL AND el.job_role_id IS NOT NULL
  ),
  reqs AS (
    SELECT al.id AS link_id, al.worker_id, al.job_role_id, al.job_role_name,
      r.document_type_id, dt.code, dt.name AS doc_name, dt.category,
      dt.has_expiration, dt.requires_file, r.is_mandatory
    FROM active_links al
    JOIN public.job_role_document_requirements r ON r.job_role_id = al.job_role_id
    JOIN public.document_types dt ON dt.id = r.document_type_id
   WHERE dt.is_active = true
  ),
  latest_wd AS (
    SELECT DISTINCT ON (wd.worker_id, wd.document_type_id)
      wd.worker_id, wd.document_type_id, wd.expiry_date,
      wd.status AS wd_status, wd.file_path
    FROM public.worker_documents wd
   WHERE wd.deleted_at IS NULL AND wd.document_type_id IS NOT NULL
   ORDER BY wd.worker_id, wd.document_type_id, wd.issue_date DESC NULLS LAST, wd.created_at DESC
  ),
  latest_nr AS (
    SELECT q.worker_id, q.document_type_id, q.expires_at AS expiry_date,
           q.document_status AS wd_status, q.document_url AS file_path,
           q.validity_status
    FROM public.worker_sst_qualifications_current q
    WHERE q.document_type_id IS NOT NULL
  ),
  evaluated AS (
    SELECT r.link_id, r.job_role_id, r.job_role_name, r.document_type_id, r.code, r.doc_name, r.is_mandatory,
      CASE
        WHEN r.category = 'sst_nr' THEN
          CASE
            WHEN nr.worker_id IS NULL THEN 'missing'
            WHEN nr.validity_status = 'unknown' THEN 'pending'
            WHEN nr.expiry_date IS NOT NULL AND nr.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN nr.wd_status = 'pending' THEN 'pending'
            WHEN nr.expiry_date IS NOT NULL
                 AND nr.expiry_date <= CURRENT_DATE + (p_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        ELSE
          CASE
            WHEN wd.worker_id IS NULL THEN 'missing'
            WHEN r.has_expiration AND wd.expiry_date IS NOT NULL AND wd.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN wd.wd_status = 'pending' THEN 'pending'
            WHEN r.requires_file AND (wd.file_path IS NULL OR wd.file_path = '') THEN 'pending'
            WHEN r.has_expiration AND wd.expiry_date IS NOT NULL
                 AND wd.expiry_date <= CURRENT_DATE + (p_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
      END AS status
    FROM reqs r
    LEFT JOIN latest_wd wd ON wd.worker_id = r.worker_id AND wd.document_type_id = r.document_type_id AND r.category <> 'sst_nr'
    LEFT JOIN latest_nr nr ON nr.worker_id = r.worker_id AND nr.document_type_id = r.document_type_id AND r.category = 'sst_nr'
  ),
  per_link_docs AS (
    SELECT link_id, job_role_id, job_role_name,
      jsonb_agg(jsonb_build_object('is_mandatory', is_mandatory, 'status', status)) AS docs
    FROM evaluated
    GROUP BY link_id, job_role_id, job_role_name
  ),
  link_status AS (
    SELECT pld.link_id, pld.job_role_id, pld.job_role_name,
      (public.calculate_compliance_overall(pld.docs)->>'overall') AS overall,
      ((public.calculate_compliance_overall(pld.docs)->'score'->>'required')::int) AS req_count,
      ((public.calculate_compliance_overall(pld.docs)->'score'->>'valid')::int)    AS ok_count,
      ((public.calculate_compliance_overall(pld.docs)->'score'->>'percent')::numeric) AS pct
    FROM per_link_docs pld
  ),
  by_role AS (
    SELECT job_role_id, job_role_name,
      COUNT(*) AS total_links,
      COUNT(*) FILTER (WHERE overall='apto') AS aptos,
      COUNT(*) FILTER (WHERE overall='atencao') AS atencao,
      COUNT(*) FILTER (WHERE overall='bloqueado') AS bloqueados,
      ROUND(AVG(pct), 2) AS percent_avg
    FROM link_status
    GROUP BY job_role_id, job_role_name
  ),
  top_pending AS (
    SELECT document_type_id, code, doc_name,
           COUNT(*) FILTER (WHERE status IN ('missing','pending','expired','warning')) AS pending_count
      FROM evaluated WHERE is_mandatory
     GROUP BY document_type_id, code, doc_name
     ORDER BY pending_count DESC NULLS LAST
     LIMIT 10
  ),
  totals AS (
    SELECT
      COUNT(*) AS total_links,
      COUNT(*) FILTER (WHERE overall='apto') AS total_aptos,
      COUNT(*) FILTER (WHERE overall='atencao') AS total_atencao,
      COUNT(*) FILTER (WHERE overall='bloqueado') AS total_bloqueados
    FROM link_status
  )
  SELECT jsonb_build_object(
    'schema_version', 2,
    'generated_at', now(),
    'warning_days', p_warning_days,
    'totals', jsonb_build_object(
      'workers', v_total_workers,
      'job_roles', v_total_job_roles,
      'links', (SELECT total_links FROM totals),
      'aptos', (SELECT total_aptos FROM totals),
      'atencao', (SELECT total_atencao FROM totals),
      'bloqueados', (SELECT total_bloqueados FROM totals)
    ),
    'by_role', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'job_role_id', job_role_id, 'job_role_name', job_role_name,
        'total_links', total_links, 'aptos', aptos, 'atencao', atencao,
        'bloqueados', bloqueados, 'percent_avg', percent_avg
      )) FROM by_role), '[]'::jsonb),
    'top_pending', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'document_type_id', document_type_id, 'code', code, 'name', doc_name,
        'pending_count', pending_count
      )) FROM top_pending), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_link_compliance_timeline(p_link_id uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      h.id,
      h.created_at,
      h.entity_type,
      h.previous_status,
      h.current_status,
      h.reason,
      h.event_source,
      h.changed_by,
      p.full_name AS changed_by_name,
      h.document_type_id,
      dt.code AS document_code,
      dt.name AS document_name,
      dt.category AS document_category
    FROM public.document_compliance_history h
    LEFT JOIN public.document_types dt ON dt.id = h.document_type_id
    LEFT JOIN public.profiles p ON p.id = h.changed_by
    WHERE h.employment_link_id = p_link_id
    ORDER BY h.created_at DESC
    LIMIT GREATEST(p_limit, 1)
  ) t;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'link_id', p_link_id,
    'generated_at', now(),
    'items', v_items
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_compliance_transitions(p_link_id uuid, p_event_source text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eval JSONB; v_worker_id UUID; v_current_overall TEXT;
  v_last_overall TEXT; v_last_hash TEXT; v_new_hash TEXT;
  v_doc JSONB; v_dt_id UUID; v_wd_id UUID; v_curr TEXT; v_prev TEXT; v_reason TEXT;
  v_actor UUID := auth.uid(); v_inserted INT := 0;
  v_event_source TEXT; v_skipped BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_event_source := COALESCE(p_event_source, 'system');
  IF v_event_source NOT IN ('upload','expiration','admin_update','job_role_change','migration','system','manual','reevaluate','link_override') THEN
    v_event_source := 'system';
  END IF;

  v_eval := public.evaluate_link_compliance(p_link_id);
  IF (v_eval->>'error') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_eval->>'error');
  END IF;

  v_worker_id := ((v_eval->'worker')->>'id')::uuid;
  v_current_overall := v_eval->>'overall';
  v_new_hash := public.compute_compliance_state_hash(v_eval);

  SELECT current_status, state_hash INTO v_last_overall, v_last_hash
  FROM public.document_compliance_history
  WHERE employment_link_id = p_link_id AND entity_type = 'overall'
  ORDER BY created_at DESC LIMIT 1;

  IF v_last_hash IS NOT NULL AND v_last_hash = v_new_hash THEN
    v_skipped := true;
  ELSE
    FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(v_eval->'documents','[]'::jsonb))
    LOOP
      v_dt_id := (v_doc->>'document_type_id')::uuid;
      v_wd_id := NULLIF(v_doc->>'worker_document_id','')::uuid;
      IF v_wd_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.worker_documents WHERE id = v_wd_id
      ) THEN
        v_wd_id := NULL;
      END IF;
      v_curr := v_doc->>'status';
      v_reason := v_doc->>'status_reason';

      SELECT current_status INTO v_prev
      FROM public.document_compliance_history
      WHERE employment_link_id = p_link_id
        AND entity_type = 'document' AND document_type_id = v_dt_id
      ORDER BY created_at DESC LIMIT 1;

      IF v_prev IS DISTINCT FROM v_curr THEN
        INSERT INTO public.document_compliance_history(
          employment_link_id, worker_id, worker_document_id, document_type_id,
          entity_type, previous_status, current_status, reason,
          event_source, changed_by, state_hash
        ) VALUES (
          p_link_id, v_worker_id, v_wd_id, v_dt_id,
          'document', v_prev, v_curr, v_reason,
          v_event_source, v_actor, NULL
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;

    INSERT INTO public.document_compliance_history(
      employment_link_id, worker_id, entity_type,
      previous_status, current_status, reason,
      event_source, changed_by, state_hash
    ) VALUES (
      p_link_id, v_worker_id, 'overall',
      v_last_overall, v_current_overall,
      CASE WHEN v_last_overall IS DISTINCT FROM v_current_overall
           THEN 'Transição do overall do vínculo'
           ELSE 'Alteração estrutural sem mudança do overall' END,
      v_event_source, v_actor, v_new_hash
    );
    v_inserted := v_inserted + 1;
  END IF;

  UPDATE public.employment_links SET last_compliance_check_at = now() WHERE id = p_link_id;

  RETURN jsonb_build_object(
    'ok', true, 'inserted', v_inserted, 'skipped', v_skipped,
    'overall', v_current_overall, 'state_hash', v_new_hash,
    'event_source', v_event_source
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reevaluate_worker_links(p_worker_id uuid, p_event_source text DEFAULT 'upload'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link RECORD;
  v_total INT := 0;
  v_transitions INT := 0;
  v_res JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR v_link IN
    SELECT id FROM public.employment_links
    WHERE worker_id = p_worker_id
      AND (deleted_at IS NULL)
  LOOP
    v_res := public.record_compliance_transitions(v_link.id, p_event_source);
    v_total := v_total + 1;
    v_transitions := v_transitions + COALESCE((v_res->>'transitions_recorded')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'links_processed', v_total, 'transitions_recorded', v_transitions
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reevaluate_job_role_links(p_job_role_id uuid, p_event_source text DEFAULT 'job_role_change'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link RECORD;
  v_total INT := 0;
  v_transitions INT := 0;
  v_res JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR v_link IN
    SELECT id FROM public.employment_links
    WHERE job_role_id = p_job_role_id
      AND (deleted_at IS NULL)
  LOOP
    v_res := public.record_compliance_transitions(v_link.id, p_event_source);
    v_total := v_total + 1;
    v_transitions := v_transitions + COALESCE((v_res->>'transitions_recorded')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'links_processed', v_total, 'transitions_recorded', v_transitions
  );
END;
$function$;