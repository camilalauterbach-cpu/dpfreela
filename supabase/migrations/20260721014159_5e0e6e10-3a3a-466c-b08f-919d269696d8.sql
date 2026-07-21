
-- ============================================================
-- E-SST.1B: Unified Compliance Engine
-- ============================================================

-- 1) Pure calculator: no DB access, no globals.
CREATE OR REPLACE FUNCTION public.calculate_compliance_overall(p_documents jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_required int := 0;
  v_valid    int := 0;
  v_warning  int := 0;
  v_expired  int := 0;
  v_missing  int := 0;
  v_pending  int := 0;
  v_percent  numeric := 0;
  v_overall  text;
BEGIN
  IF p_documents IS NULL OR jsonb_typeof(p_documents) <> 'array' THEN
    RETURN jsonb_build_object(
      'overall', 'apto',
      'score', jsonb_build_object(
        'required',0,'valid',0,'warning',0,'expired',0,'missing',0,'pending',0,'percent',0
      )
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE COALESCE((d->>'is_mandatory')::boolean, true)),
    COUNT(*) FILTER (WHERE COALESCE((d->>'is_mandatory')::boolean, true) AND d->>'status'='ok'),
    COUNT(*) FILTER (WHERE COALESCE((d->>'is_mandatory')::boolean, true) AND d->>'status'='warning'),
    COUNT(*) FILTER (WHERE COALESCE((d->>'is_mandatory')::boolean, true) AND d->>'status'='expired'),
    COUNT(*) FILTER (WHERE COALESCE((d->>'is_mandatory')::boolean, true) AND d->>'status'='missing'),
    COUNT(*) FILTER (WHERE COALESCE((d->>'is_mandatory')::boolean, true) AND d->>'status'='pending')
  INTO v_required, v_valid, v_warning, v_expired, v_missing, v_pending
  FROM jsonb_array_elements(p_documents) d;

  IF v_required > 0 THEN
    v_percent := ROUND((v_valid::numeric / v_required::numeric) * 100, 2);
  ELSE
    v_percent := 100;
  END IF;

  v_overall := CASE
    WHEN v_required = 0 THEN 'apto'
    WHEN (v_missing > 0 OR v_expired > 0) THEN 'bloqueado'
    WHEN (v_pending > 0 OR v_warning > 0) THEN 'atencao'
    ELSE 'apto'
  END;

  RETURN jsonb_build_object(
    'overall', v_overall,
    'score', jsonb_build_object(
      'required', v_required,
      'valid',    v_valid,
      'warning',  v_warning,
      'expired',  v_expired,
      'missing',  v_missing,
      'pending',  v_pending,
      'percent',  v_percent
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_compliance_overall(jsonb) TO authenticated, service_role;

-- ============================================================
-- 2) evaluate_link_compliance — canonical, NR reads from
--    worker_sst_qualifications_current; overall via calculator.
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_link_compliance(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link record;
  v_worker record;
  v_role record;
  v_event record;
  v_warning_days int := 30;
  v_docs jsonb;
  v_overall_calc jsonb;
  v_required_by_sources jsonb;
BEGIN
  SELECT el.id, el.worker_id, el.job_role_id, el.event_id, el.end_date
    INTO v_link
    FROM public.employment_links el
   WHERE el.id = p_link_id;

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 2, 'error','link_not_found');
  END IF;

  SELECT w.id, w.full_name AS name INTO v_worker
    FROM public.workers w WHERE w.id = v_link.worker_id;

  SELECT jr.id, jr.name INTO v_role
    FROM public.job_roles jr WHERE jr.id = v_link.job_role_id;

  IF v_link.event_id IS NOT NULL THEN
    SELECT e.id, e.name INTO v_event
      FROM public.events e WHERE e.id = v_link.event_id;
  END IF;

  WITH reqs AS (
    SELECT
      r.document_type_id, dt.code, dt.name, dt.category,
      dt.has_expiration, dt.requires_file, dt.default_validity_days,
      r.is_mandatory, r.validity_days_override, r.display_order,
      COALESCE(r.required_by, 'job_role') AS required_by
    FROM public.job_role_document_requirements r
    JOIN public.document_types dt ON dt.id = r.document_type_id
   WHERE r.job_role_id = v_link.job_role_id AND dt.is_active = true
  ),
  -- Non-SST document source: worker_documents, fallback employment_link_documents
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
  -- SST source: worker_sst_qualifications_current (canonical NR registry)
  latest_nr AS (
    SELECT
      q.id AS worker_document_id,
      q.document_type_id,
      q.expires_at AS expiry_date,
      q.issued_at::date AS issue_date,
      q.document_status AS wd_status,
      q.document_url AS file_path,
      q.validity_status,
      q.expiration_status
    FROM public.worker_sst_qualifications_current q
   WHERE q.worker_id = v_link.worker_id
     AND q.document_type_id IS NOT NULL
  ),
  evaluated AS (
    SELECT
      reqs.document_type_id, reqs.code, reqs.name, reqs.category,
      reqs.is_mandatory, reqs.required_by, reqs.display_order,
      reqs.requires_file, reqs.has_expiration,
      -- Source precedence per category
      CASE
        WHEN reqs.category = 'sst_nr' THEN nr.worker_document_id
        ELSE COALESCE(wd.worker_document_id, eld.worker_document_id)
      END AS worker_document_id,
      CASE
        WHEN reqs.category = 'sst_nr' THEN nr.expiry_date
        ELSE COALESCE(wd.expiry_date, eld.expiry_date)
      END AS expiry_date,
      CASE
        WHEN reqs.category = 'sst_nr' THEN nr.file_path
        ELSE COALESCE(wd.file_path, eld.file_path)
      END AS file_path,
      CASE
        WHEN reqs.category = 'sst_nr' THEN nr.wd_status
        ELSE COALESCE(wd.wd_status, eld.wd_status)
      END AS wd_status,
      CASE
        WHEN reqs.category = 'sst_nr' THEN nr.validity_status
        ELSE NULL
      END AS nr_validity_status,
      CASE
        WHEN reqs.category = 'sst_nr' THEN
          CASE
            WHEN nr.worker_document_id IS NULL THEN NULL
            WHEN nr.validity_status = 'no_expiry' THEN NULL
            WHEN nr.expires_at IS NULL THEN NULL
            ELSE (nr.expires_at - CURRENT_DATE)
          END
        ELSE
          CASE WHEN wd.expiry_date IS NOT NULL
            THEN (wd.expiry_date - CURRENT_DATE) ELSE NULL END
      END AS days_remaining
    FROM reqs
    LEFT JOIN latest_wd wd  ON wd.document_type_id  = reqs.document_type_id AND reqs.category <> 'sst_nr'
    LEFT JOIN latest_eld eld ON eld.document_type_id = reqs.document_type_id AND reqs.category <> 'sst_nr'
    LEFT JOIN latest_nr nr   ON nr.document_type_id  = reqs.document_type_id AND reqs.category = 'sst_nr'
  ),
  scored AS (
    SELECT e.*,
      CASE
        WHEN e.worker_document_id IS NULL THEN 'missing'
        WHEN e.category = 'sst_nr' THEN
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
            WHEN e.requires_file AND (e.file_path IS NULL OR e.file_path = '') THEN 'pending'
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
        WHEN 'missing' THEN 'Não possui'
        WHEN 'expired' THEN 'Vencido'
        WHEN 'pending' THEN 'Pendente'
        WHEN 'warning' THEN 'Vencendo'
        WHEN 'ok'      THEN 'Válido'
      END AS status_label,
      CASE s.status
        WHEN 'missing' THEN
          CASE WHEN s.is_mandatory
            THEN 'Documento obrigatório não encontrado'
            ELSE 'Documento opcional não anexado' END
        WHEN 'expired' THEN
          'Documento vencido em ' || to_char(s.expiry_date, 'DD/MM/YYYY')
        WHEN 'pending' THEN
          CASE WHEN s.requires_file AND (s.file_path IS NULL OR s.file_path = '')
            THEN 'Documento aguardando anexo'
            ELSE 'Documento pendente de validação' END
        WHEN 'warning' THEN
          'Vence em ' || s.days_remaining || ' dia(s), em ' || to_char(s.expiry_date, 'DD/MM/YYYY')
        WHEN 'ok' THEN
          CASE WHEN s.has_expiration AND s.expiry_date IS NOT NULL
            THEN 'Válido até ' || to_char(s.expiry_date, 'DD/MM/YYYY')
            ELSE 'Documento válido' END
      END AS status_reason
    FROM scored s
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'document_type_id', document_type_id,
        'code', code,
        'name', name,
        'category', category,
        'status', status,
        'status_code', status,
        'status_label', status_label,
        'status_reason', status_reason,
        'expires_at', expiry_date,
        'days_remaining', days_remaining,
        'worker_document_id', worker_document_id,
        'is_mandatory', is_mandatory,
        'required_by', required_by,
        'display_order', display_order,
        'reason_params', jsonb_build_object(
          'expiry_date', expiry_date,
          'days_remaining', days_remaining,
          'required_until', v_link.end_date,
          'link_start', NULL,
          'link_end', v_link.end_date,
          'document_type_code', code
        )
      )
      ORDER BY
        CASE status
          WHEN 'missing' THEN 1 WHEN 'expired' THEN 2
          WHEN 'pending' THEN 3 WHEN 'warning' THEN 4
          WHEN 'ok' THEN 5 END,
        display_order, name
    )
  INTO v_docs
  FROM labeled;

  v_docs := COALESCE(v_docs, '[]'::jsonb);
  v_overall_calc := public.calculate_compliance_overall(v_docs);

  -- Build required_by_sources with names
  v_required_by_sources := '[]'::jsonb;
  IF v_role.id IS NOT NULL THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','job_role','id',v_role.id,'name',v_role.name)
    );
  END IF;
  IF v_event.id IS NOT NULL THEN
    v_required_by_sources := v_required_by_sources || jsonb_build_array(
      jsonb_build_object('type','event','id',v_event.id,'name',v_event.name)
    );
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
    'required_by_sources', v_required_by_sources,
    'score', v_overall_calc->'score',
    'documents', v_docs,
    'evaluated_at', now(),
    'warning_days', v_warning_days
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_link_compliance(uuid) TO authenticated, service_role;

-- ============================================================
-- 3) simulate_link_compliance — same engine (calculator + NR source)
-- ============================================================
CREATE OR REPLACE FUNCTION public.simulate_link_compliance(p_link_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link RECORD;
  v_worker RECORD;
  v_role RECORD;
  v_event RECORD;
  v_warning_days INT := 30;
  v_docs JSONB;
  v_overall_calc JSONB;
  v_required_by_sources jsonb;
  v_remove_req UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'remove_requirement_type_ids','[]'::jsonb)))::uuid);
  v_add_req JSONB := COALESCE(p_overrides->'add_requirements','[]'::jsonb);
  v_add_docs JSONB := COALESCE(p_overrides->'add_worker_documents','[]'::jsonb);
  v_remove_docs UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'remove_worker_document_ids','[]'::jsonb)))::uuid);
  v_expire UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'expire_document_type_ids','[]'::jsonb)))::uuid);
BEGIN
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

  WITH base_reqs AS (
    SELECT r.document_type_id, dt.code, dt.name, dt.category,
           dt.has_expiration, dt.requires_file, dt.default_validity_days,
           r.is_mandatory, r.validity_days_override, r.display_order, COALESCE(r.required_by,'job_role') AS required_by
      FROM public.job_role_document_requirements r
      JOIN public.document_types dt ON dt.id = r.document_type_id
     WHERE r.job_role_id = v_link.job_role_id AND dt.is_active = true
       AND NOT (r.document_type_id = ANY(v_remove_req))
  ),
  extra_reqs AS (
    SELECT (a->>'document_type_id')::uuid AS document_type_id,
           dt.code, dt.name, dt.category, dt.has_expiration, dt.requires_file, dt.default_validity_days,
           COALESCE((a->>'is_mandatory')::boolean, true) AS is_mandatory,
           NULLIF(a->>'validity_days_override','')::int AS validity_days_override,
           COALESCE((a->>'display_order')::int, 9999) AS display_order,
           COALESCE(a->>'required_by','job_role') AS required_by
      FROM jsonb_array_elements(v_add_req) a
      JOIN public.document_types dt ON dt.id = (a->>'document_type_id')::uuid
     WHERE dt.is_active = true
  ),
  reqs AS (
    SELECT * FROM base_reqs
    UNION ALL
    SELECT * FROM extra_reqs WHERE document_type_id NOT IN (SELECT document_type_id FROM base_reqs)
  ),
  -- Non-SST worker documents
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
  latest_nr AS (
    SELECT q.id AS worker_document_id, q.document_type_id,
           q.expires_at AS expiry_date, q.issued_at::date AS issue_date,
           q.document_status AS wd_status, q.document_url AS file_path,
           q.validity_status
    FROM public.worker_sst_qualifications_current q
    WHERE q.worker_id = v_link.worker_id AND q.document_type_id IS NOT NULL
  ),
  evaluated AS (
    SELECT
      reqs.document_type_id, reqs.code, reqs.name, reqs.category,
      reqs.is_mandatory, reqs.required_by, reqs.display_order,
      reqs.requires_file, reqs.has_expiration,
      CASE WHEN reqs.category='sst_nr' THEN nr.worker_document_id ELSE wd.worker_document_id END AS worker_document_id,
      CASE
        WHEN reqs.document_type_id = ANY(v_expire) THEN CURRENT_DATE - 1
        WHEN reqs.category='sst_nr' THEN nr.expiry_date
        ELSE wd.expiry_date
      END AS expiry_date,
      CASE WHEN reqs.category='sst_nr' THEN nr.file_path ELSE wd.file_path END AS file_path,
      CASE WHEN reqs.category='sst_nr' THEN nr.wd_status ELSE wd.wd_status END AS wd_status,
      CASE WHEN reqs.category='sst_nr' THEN nr.validity_status ELSE NULL END AS nr_validity_status,
      (reqs.category <> 'sst_nr' AND wd.worker_document_id IS NULL AND EXISTS(SELECT 1 FROM sim_docs s WHERE s.document_type_id = reqs.document_type_id)) AS is_simulated
    FROM reqs
    LEFT JOIN latest_wd wd ON wd.document_type_id = reqs.document_type_id AND reqs.category <> 'sst_nr'
    LEFT JOIN latest_nr nr ON nr.document_type_id = reqs.document_type_id AND reqs.category  = 'sst_nr'
  ),
  scored AS (
    SELECT e.*,
      CASE WHEN e.expiry_date IS NOT NULL THEN (e.expiry_date - CURRENT_DATE) ELSE NULL END AS days_remaining,
      CASE
        WHEN e.worker_document_id IS NULL AND NOT COALESCE(e.is_simulated,false) THEN 'missing'
        WHEN e.document_type_id = ANY(v_expire) THEN 'expired'
        WHEN e.category='sst_nr' AND e.nr_validity_status='unknown' THEN 'pending'
        WHEN e.expiry_date IS NOT NULL AND e.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN e.wd_status = 'pending' THEN 'pending'
        WHEN e.category<>'sst_nr' AND e.requires_file AND (e.file_path IS NULL OR e.file_path='') THEN 'pending'
        WHEN e.has_expiration AND e.expiry_date IS NOT NULL
             AND e.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
        ELSE 'ok'
      END AS status
    FROM evaluated e
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'document_type_id', document_type_id, 'code', code, 'name', name, 'category', category,
        'status', status, 'status_code', status,
        'expires_at', expiry_date, 'days_remaining', days_remaining,
        'worker_document_id', worker_document_id,
        'is_mandatory', is_mandatory, 'required_by', required_by,
        'display_order', display_order,
        'simulated', COALESCE(is_simulated,false) OR (document_type_id = ANY(v_expire)),
        'reason_params', jsonb_build_object(
          'expiry_date', expiry_date,
          'days_remaining', days_remaining,
          'required_until', v_link.end_date,
          'link_start', NULL,
          'link_end', v_link.end_date,
          'document_type_code', code
        )
      )
      ORDER BY
        CASE status WHEN 'missing' THEN 1 WHEN 'expired' THEN 2 WHEN 'pending' THEN 3 WHEN 'warning' THEN 4 WHEN 'ok' THEN 5 END,
        display_order, name
    )
  INTO v_docs
  FROM scored;

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

  RETURN jsonb_build_object(
    'schema_version', 2,
    'simulated', true,
    'overall', v_overall_calc->>'overall',
    'link_id', p_link_id,
    'worker', CASE WHEN v_worker.id IS NOT NULL THEN jsonb_build_object('id', v_worker.id, 'name', v_worker.name) ELSE NULL END,
    'job_role', CASE WHEN v_role.id IS NOT NULL THEN jsonb_build_object('id', v_role.id, 'name', v_role.name) ELSE NULL END,
    'event', CASE WHEN v_event.id IS NOT NULL THEN jsonb_build_object('id', v_event.id, 'name', v_event.name) ELSE NULL END,
    'required_by_sources', v_required_by_sources,
    'score', v_overall_calc->'score',
    'documents', v_docs,
    'evaluated_at', now(),
    'warning_days', v_warning_days,
    'applied_overrides', p_overrides
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.simulate_link_compliance(uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- 4) document_compliance_summary — reuses calculate_compliance_overall
--    and reads NRs from worker_sst_qualifications_current.
-- ============================================================
CREATE OR REPLACE FUNCTION public.document_compliance_summary(p_warning_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_total_workers int;
  v_total_job_roles int;
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.document_compliance_summary(integer) TO authenticated, service_role;
