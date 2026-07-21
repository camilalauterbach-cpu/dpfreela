
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
    INTO v_link FROM public.employment_links el WHERE el.id = p_link_id;

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 2, 'error','link_not_found');
  END IF;

  SELECT w.id, w.full_name AS name INTO v_worker FROM public.workers w WHERE w.id = v_link.worker_id;
  SELECT jr.id, jr.name INTO v_role FROM public.job_roles jr WHERE jr.id = v_link.job_role_id;
  IF v_link.event_id IS NOT NULL THEN
    SELECT e.id, e.name INTO v_event FROM public.events e WHERE e.id = v_link.event_id;
  END IF;

  WITH reqs AS (
    SELECT r.document_type_id, dt.code, dt.name, dt.category,
      dt.has_expiration, dt.requires_file, dt.default_validity_days,
      r.is_mandatory, r.validity_days_override, r.display_order,
      COALESCE(r.required_by,'job_role') AS required_by
    FROM public.job_role_document_requirements r
    JOIN public.document_types dt ON dt.id = r.document_type_id
   WHERE r.job_role_id = v_link.job_role_id AND dt.is_active = true
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
      CASE WHEN reqs.category='sst_nr' THEN nr.worker_document_id
           ELSE COALESCE(wd.worker_document_id, eld.worker_document_id) END AS worker_document_id,
      CASE WHEN reqs.category='sst_nr' THEN nr.expiry_date
           ELSE COALESCE(wd.expiry_date, eld.expiry_date) END AS expiry_date,
      CASE WHEN reqs.category='sst_nr' THEN nr.file_path
           ELSE COALESCE(wd.file_path, eld.file_path) END AS file_path,
      CASE WHEN reqs.category='sst_nr' THEN nr.wd_status
           ELSE COALESCE(wd.wd_status, eld.wd_status) END AS wd_status,
      CASE WHEN reqs.category='sst_nr' THEN nr.validity_status ELSE NULL END AS nr_validity_status
    FROM reqs
    LEFT JOIN latest_wd wd   ON wd.document_type_id  = reqs.document_type_id AND reqs.category <> 'sst_nr'
    LEFT JOIN latest_eld eld ON eld.document_type_id = reqs.document_type_id AND reqs.category <> 'sst_nr'
    LEFT JOIN latest_nr nr   ON nr.document_type_id  = reqs.document_type_id AND reqs.category  = 'sst_nr'
  ),
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
        'display_order', display_order,
        'reason_params', jsonb_build_object(
          'expiry_date', expiry_date, 'days_remaining', days_remaining,
          'required_until', v_link.end_date,
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
