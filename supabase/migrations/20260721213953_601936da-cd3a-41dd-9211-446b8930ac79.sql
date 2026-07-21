
-- Fix 1: calculate_compliance_overall — required=0 vira 'nao_configurado' (não mais 'apto')
CREATE OR REPLACE FUNCTION public.calculate_compliance_overall(p_documents jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
      'overall', 'nao_configurado',
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
    v_percent := 0;
  END IF;

  v_overall := CASE
    WHEN v_required = 0 THEN 'nao_configurado'
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
$function$;

-- Fix 2: evaluate_link_compliance — job_role_id NULL força 'nao_configurado'
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
  v_overall text;
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

  -- Força 'nao_configurado' quando não há cargo definido
  v_overall := v_overall_calc->>'overall';
  IF v_role.id IS NULL THEN
    v_overall := 'nao_configurado';
  END IF;

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
    'overall', v_overall,
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
