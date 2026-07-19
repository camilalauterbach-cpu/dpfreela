
CREATE OR REPLACE FUNCTION public.evaluate_link_compliance(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link record;
  v_worker record;
  v_role record;
  v_warning_days int := 30;
  v_docs jsonb;
  v_score jsonb;
  v_overall text;
  v_required int := 0;
  v_valid int := 0;
  v_warning int := 0;
  v_expired int := 0;
  v_missing int := 0;
  v_pending int := 0;
  v_percent numeric := 0;
  v_has_blocker boolean;
  v_has_attention boolean;
BEGIN
  SELECT el.id, el.worker_id, el.job_role_id
    INTO v_link
    FROM public.employment_links el
   WHERE el.id = p_link_id;

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 1, 'error','link_not_found');
  END IF;

  SELECT w.id, w.full_name AS name INTO v_worker
    FROM public.workers w WHERE w.id = v_link.worker_id;

  SELECT jr.id, jr.name INTO v_role
    FROM public.job_roles jr WHERE jr.id = v_link.job_role_id;

  WITH reqs AS (
    SELECT
      r.document_type_id, dt.code, dt.name, dt.category,
      dt.has_expiration, dt.requires_file, dt.default_validity_days,
      r.is_mandatory, r.validity_days_override, r.display_order, r.required_by
    FROM public.job_role_document_requirements r
    JOIN public.document_types dt ON dt.id = r.document_type_id
   WHERE r.job_role_id = v_link.job_role_id AND dt.is_active = true
  ),
  latest_docs AS (
    SELECT DISTINCT ON (wd.document_type_id)
      wd.id AS worker_document_id, wd.document_type_id,
      wd.expiry_date, wd.issue_date, wd.status AS wd_status, wd.file_path
    FROM public.worker_documents wd
   WHERE wd.worker_id = v_link.worker_id
     AND wd.deleted_at IS NULL AND wd.document_type_id IS NOT NULL
   ORDER BY wd.document_type_id, wd.issue_date DESC NULLS LAST, wd.created_at DESC
  ),
  evaluated AS (
    SELECT
      reqs.document_type_id, reqs.code, reqs.name, reqs.category,
      reqs.is_mandatory, reqs.required_by, reqs.display_order,
      reqs.requires_file, reqs.has_expiration,
      ld.worker_document_id, ld.expiry_date, ld.file_path,
      CASE WHEN ld.expiry_date IS NOT NULL
        THEN (ld.expiry_date - CURRENT_DATE) ELSE NULL END AS days_remaining,
      CASE
        WHEN ld.worker_document_id IS NULL THEN 'missing'
        WHEN reqs.has_expiration AND ld.expiry_date IS NOT NULL AND ld.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN ld.wd_status = 'pending' THEN 'pending'
        WHEN reqs.requires_file AND (ld.file_path IS NULL OR ld.file_path = '') THEN 'pending'
        WHEN reqs.has_expiration AND ld.expiry_date IS NOT NULL
             AND ld.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
        ELSE 'ok'
      END AS status
    FROM reqs
    LEFT JOIN latest_docs ld ON ld.document_type_id = reqs.document_type_id
  ),
  labeled AS (
    SELECT e.*,
      CASE e.status
        WHEN 'missing' THEN 'Não possui'
        WHEN 'expired' THEN 'Vencido'
        WHEN 'pending' THEN 'Pendente'
        WHEN 'warning' THEN 'Vencendo'
        WHEN 'ok'      THEN 'Válido'
      END AS status_label,
      CASE e.status
        WHEN 'missing' THEN
          CASE WHEN e.is_mandatory
            THEN 'Documento obrigatório não encontrado'
            ELSE 'Documento opcional não anexado' END
        WHEN 'expired' THEN
          'Documento vencido em ' || to_char(e.expiry_date, 'DD/MM/YYYY')
        WHEN 'pending' THEN
          CASE WHEN e.requires_file AND (e.file_path IS NULL OR e.file_path = '')
            THEN 'Documento aguardando anexo'
            ELSE 'Documento pendente de validação' END
        WHEN 'warning' THEN
          'Vence em ' || e.days_remaining || ' dia(s), em ' || to_char(e.expiry_date, 'DD/MM/YYYY')
        WHEN 'ok' THEN
          CASE WHEN e.has_expiration AND e.expiry_date IS NOT NULL
            THEN 'Válido até ' || to_char(e.expiry_date, 'DD/MM/YYYY')
            ELSE 'Documento válido' END
      END AS status_reason
    FROM evaluated e
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
        'required_by', required_by
      )
      ORDER BY
        CASE status
          WHEN 'missing' THEN 1 WHEN 'expired' THEN 2
          WHEN 'pending' THEN 3 WHEN 'warning' THEN 4
          WHEN 'ok' THEN 5 END,
        display_order, name
    ),
    COUNT(*) FILTER (WHERE is_mandatory),
    COUNT(*) FILTER (WHERE status = 'ok' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'warning' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'expired' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'missing' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'pending' AND is_mandatory)
  INTO v_docs, v_required, v_valid, v_warning, v_expired, v_missing, v_pending
  FROM labeled;

  IF v_required > 0 THEN
    v_percent := ROUND((v_valid::numeric / v_required::numeric) * 100, 2);
  END IF;

  v_has_blocker := (v_missing > 0 OR v_expired > 0);
  v_has_attention := (v_pending > 0 OR v_warning > 0);

  v_overall := CASE
    WHEN v_required = 0 THEN 'apto'
    WHEN v_has_blocker THEN 'bloqueado'
    WHEN v_has_attention THEN 'atencao'
    ELSE 'apto'
  END;

  v_score := jsonb_build_object(
    'required', v_required, 'valid', v_valid, 'warning', v_warning,
    'expired', v_expired, 'missing', v_missing, 'pending', v_pending,
    'percent', v_percent
  );

  RETURN jsonb_build_object(
    'schema_version', 1,
    'overall', v_overall,
    'link_id', v_link.id,
    'job_role', CASE WHEN v_role.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', v_role.id, 'name', v_role.name) END,
    'worker', CASE WHEN v_worker.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', v_worker.id, 'name', v_worker.name) END,
    'score', v_score,
    'documents', COALESCE(v_docs, '[]'::jsonb),
    'evaluated_at', now(),
    'warning_days', v_warning_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_link_compliance(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.evaluate_link_compliance(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.document_compliance_summary(p_warning_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_total_workers int;
  v_total_job_roles int;
BEGIN
  SELECT COUNT(*) INTO v_total_workers
    FROM public.workers WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO v_total_job_roles
    FROM public.job_roles WHERE is_active = true;

  WITH active_links AS (
    SELECT el.id, el.worker_id, el.job_role_id, jr.name AS job_role_name
      FROM public.employment_links el
      LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
     WHERE el.deleted_at IS NULL AND el.job_role_id IS NOT NULL
  ),
  reqs AS (
    SELECT al.id AS link_id, al.worker_id, al.job_role_id, al.job_role_name,
      r.document_type_id, dt.code, dt.name AS doc_name,
      dt.has_expiration, dt.requires_file, r.is_mandatory
    FROM active_links al
    JOIN public.job_role_document_requirements r ON r.job_role_id = al.job_role_id
    JOIN public.document_types dt ON dt.id = r.document_type_id
   WHERE dt.is_active = true
  ),
  latest_docs AS (
    SELECT DISTINCT ON (wd.worker_id, wd.document_type_id)
      wd.worker_id, wd.document_type_id, wd.expiry_date,
      wd.status AS wd_status, wd.file_path
    FROM public.worker_documents wd
   WHERE wd.deleted_at IS NULL AND wd.document_type_id IS NOT NULL
   ORDER BY wd.worker_id, wd.document_type_id, wd.issue_date DESC NULLS LAST, wd.created_at DESC
  ),
  evaluated AS (
    SELECT reqs.*, ld.expiry_date,
      CASE
        WHEN ld.worker_id IS NULL THEN 'missing'
        WHEN reqs.has_expiration AND ld.expiry_date IS NOT NULL AND ld.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN ld.wd_status = 'pending' THEN 'pending'
        WHEN reqs.requires_file AND (ld.file_path IS NULL OR ld.file_path = '') THEN 'pending'
        WHEN reqs.has_expiration AND ld.expiry_date IS NOT NULL
             AND ld.expiry_date <= CURRENT_DATE + (p_warning_days || ' days')::interval THEN 'warning'
        ELSE 'ok'
      END AS status
    FROM reqs
    LEFT JOIN latest_docs ld
      ON ld.worker_id = reqs.worker_id AND ld.document_type_id = reqs.document_type_id
  ),
  link_overall AS (
    SELECT link_id, job_role_id, job_role_name,
      BOOL_OR(is_mandatory AND status IN ('missing','expired')) AS has_blocker,
      BOOL_OR(is_mandatory AND status IN ('pending','warning')) AS has_attention,
      COUNT(*) FILTER (WHERE is_mandatory) AS req_count,
      COUNT(*) FILTER (WHERE is_mandatory AND status='ok') AS ok_count
    FROM evaluated
    GROUP BY link_id, job_role_id, job_role_name
  ),
  link_status AS (
    SELECT link_id, job_role_id, job_role_name, req_count, ok_count,
      CASE
        WHEN req_count = 0 THEN 'apto'
        WHEN has_blocker THEN 'bloqueado'
        WHEN has_attention THEN 'atencao'
        ELSE 'apto'
      END AS overall
    FROM link_overall
  ),
  by_role AS (
    SELECT job_role_id, job_role_name,
      COUNT(*) AS total_links,
      COUNT(*) FILTER (WHERE overall='apto') AS aptos,
      COUNT(*) FILTER (WHERE overall='atencao') AS atencao,
      COUNT(*) FILTER (WHERE overall='bloqueado') AS bloqueados,
      ROUND(AVG(CASE WHEN req_count>0 THEN (ok_count::numeric/req_count::numeric)*100 ELSE 100 END), 2) AS percent_avg
    FROM link_status
    GROUP BY job_role_id, job_role_name
  ),
  top_pending AS (
    SELECT document_type_id, code, doc_name,
           COUNT(*) FILTER (WHERE status IN ('missing','pending','expired','warning')) AS pending_count
      FROM evaluated WHERE is_mandatory
     GROUP BY document_type_id, code, doc_name
     HAVING COUNT(*) FILTER (WHERE status IN ('missing','pending','expired','warning')) > 0
     ORDER BY pending_count DESC LIMIT 10
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'generated_at', now(),
    'warning_days', p_warning_days,
    'totals', jsonb_build_object(
      'workers', v_total_workers,
      'links', (SELECT COUNT(*) FROM link_status),
      'job_roles', v_total_job_roles,
      'aptos', (SELECT COUNT(*) FROM link_status WHERE overall='apto'),
      'atencao', (SELECT COUNT(*) FROM link_status WHERE overall='atencao'),
      'bloqueados', (SELECT COUNT(*) FROM link_status WHERE overall='bloqueado')
    ),
    'documents', jsonb_build_object(
      'ok', (SELECT COUNT(*) FROM evaluated WHERE is_mandatory AND status='ok'),
      'warning', (SELECT COUNT(*) FROM evaluated WHERE is_mandatory AND status='warning'),
      'expired', (SELECT COUNT(*) FROM evaluated WHERE is_mandatory AND status='expired'),
      'missing', (SELECT COUNT(*) FROM evaluated WHERE is_mandatory AND status='missing'),
      'pending', (SELECT COUNT(*) FROM evaluated WHERE is_mandatory AND status='pending')
    ),
    'by_role', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'job_role_id', job_role_id, 'job_role_name', job_role_name,
      'total_links', total_links, 'aptos', aptos, 'atencao', atencao,
      'bloqueados', bloqueados, 'percent_avg', percent_avg
    ) ORDER BY bloqueados DESC, atencao DESC) FROM by_role), '[]'::jsonb),
    'top_pending_documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'document_type_id', document_type_id, 'code', code,
      'name', doc_name, 'pending_count', pending_count
    )) FROM top_pending), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.document_compliance_summary(int) FROM public;
GRANT EXECUTE ON FUNCTION public.document_compliance_summary(int) TO authenticated, service_role;
