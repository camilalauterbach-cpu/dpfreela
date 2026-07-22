-- ============================================================
-- Fase 1.5 — Cálculo de vencimento NR e precedência do cargo
-- ============================================================

-- 1) register_sst_revision: calcula expires_at a partir de default_validity_days
--    quando validity_status='has_expiry' e expires_at não vier explicitamente.
CREATE OR REPLACE FUNCTION public.register_sst_revision(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_worker uuid;
  v_nr text;
  v_norm text;
  v_doc_type_id uuid;
  v_default_days int;
  v_op text;
  v_prev uuid;
  v_issued date;
  v_expires date;
  v_validity text;
  v_new_id uuid;
  v_prev_rec record;
  v_source text;
  v_revision text;
  v_expiry_source text;
  v_validity_days_used int;
  v_expires_had_input boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  v_worker  := (payload->>'worker_id')::uuid;
  v_nr      := upper(btrim(coalesce(payload->>'nr_code','')));
  v_op      := coalesce(payload->>'operation','initial');
  v_prev    := nullif(payload->>'previous_qualification_id','')::uuid;
  v_issued  := nullif(payload->>'issued_at','')::date;
  v_expires_had_input := (nullif(payload->>'expires_at','') IS NOT NULL);
  v_expires := nullif(payload->>'expires_at','')::date;
  v_validity := coalesce(payload->>'validity_status','unknown');
  v_source  := coalesce(payload->>'source_type','manual');
  v_revision := CASE v_op
                  WHEN 'renewal' THEN 'renewal'
                  WHEN 'replacement' THEN 'replacement'
                  WHEN 'additional' THEN 'additional'
                  ELSE 'initial'
                END;

  IF v_worker IS NULL THEN RAISE EXCEPTION 'missing_worker_id' USING ERRCODE='22023'; END IF;
  IF v_nr = '' THEN RAISE EXCEPTION 'missing_nr_code' USING ERRCODE='22023'; END IF;
  IF v_issued IS NULL THEN RAISE EXCEPTION 'missing_issued_at' USING ERRCODE='22023'; END IF;
  IF v_source NOT IN ('manual','link_document','import') THEN
    RAISE EXCEPTION 'invalid_source_type' USING ERRCODE='22023';
  END IF;

  -- Resolve o document_type_id oficial via catálogo.
  v_norm := public.f_normalize_nr_code(v_nr);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'invalid_nr_code_format' USING ERRCODE='22023',
      HINT = 'Use o padrão NRxx (ex.: NR10, NR35).';
  END IF;
  SELECT id, default_validity_days INTO v_doc_type_id, v_default_days
    FROM public.document_types
   WHERE category = 'sst_nr' AND code = v_norm;
  IF v_doc_type_id IS NULL THEN
    RAISE EXCEPTION 'nr_code_not_in_catalog' USING ERRCODE='22023',
      HINT = 'Cadastre o tipo em document_types (categoria sst_nr) antes de registrar.';
  END IF;

  -- Segunda barreira: se validity_status='has_expiry' e expires_at não veio,
  -- calcular a partir de default_validity_days do document_type.
  v_expiry_source := 'explicit';
  v_validity_days_used := NULL;
  IF v_validity = 'has_expiry' AND v_expires IS NULL AND v_default_days IS NOT NULL AND v_default_days > 0 THEN
    v_expires := v_issued + (v_default_days || ' days')::interval;
    v_expiry_source := 'document_type_default';
    v_validity_days_used := v_default_days;
  ELSIF v_expires_had_input THEN
    v_expiry_source := 'explicit';
    v_validity_days_used := (v_expires - v_issued);
  END IF;

  IF v_validity = 'has_expiry' AND (v_expires IS NULL OR v_expires <= v_issued) THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || '|' || v_nr, 0)
  );

  IF v_op IN ('renewal','replacement') THEN
    IF v_prev IS NULL THEN
      SELECT * INTO v_prev_rec
        FROM public.worker_sst_qualifications
       WHERE worker_id = v_worker
         AND nr_code   = v_nr
         AND revision_type <> 'additional'
         AND deleted_at IS NULL
         AND superseded_at IS NULL
       ORDER BY issued_at DESC, created_at DESC
       LIMIT 1
       FOR UPDATE;
      v_prev := v_prev_rec.id;
    ELSE
      SELECT * INTO v_prev_rec
        FROM public.worker_sst_qualifications
       WHERE id = v_prev
       FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'previous_not_found' USING ERRCODE='22023'; END IF;
      IF v_prev_rec.worker_id <> v_worker OR v_prev_rec.nr_code <> v_nr THEN
        RAISE EXCEPTION 'previous_chain_mismatch' USING ERRCODE='22023';
      END IF;
      IF v_prev_rec.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'previous_deleted' USING ERRCODE='22023';
      END IF;
      IF v_prev_rec.revision_type = 'additional' THEN
        RAISE EXCEPTION 'previous_is_additional' USING ERRCODE='22023';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.worker_sst_qualifications (
    worker_id, nr_code, document_type_id, training_type, issued_at, expires_at,
    workload_hours, provider_name, provider_document, instructor_name,
    document_url, document_status, validity_status, notes,
    supersedes_id, source_type, revision_type, revision_reason,
    employment_link_document_id, link_group_worker_id, link_group_id,
    event_id, company_id, created_by
  ) VALUES (
    v_worker, v_nr, v_doc_type_id,
    nullif(btrim(coalesce(payload->>'training_type','')),''),
    v_issued, v_expires,
    nullif(payload->>'workload_hours','')::numeric,
    nullif(btrim(coalesce(payload->>'provider_name','')),''),
    nullif(btrim(coalesce(payload->>'provider_document','')),''),
    nullif(btrim(coalesce(payload->>'instructor_name','')),''),
    nullif(btrim(coalesce(payload->>'document_url','')),''),
    coalesce(payload->>'document_status','pending'),
    v_validity,
    nullif(btrim(coalesce(payload->>'notes','')),''),
    CASE WHEN v_op IN ('renewal','replacement') THEN v_prev ELSE NULL END,
    v_source, v_revision,
    CASE v_op
      WHEN 'renewal'     THEN 'renewed'::public.sst_revision_reason
      WHEN 'replacement' THEN 'replaced'::public.sst_revision_reason
      ELSE                    'created'::public.sst_revision_reason
    END,
    nullif(payload->>'employment_link_document_id','')::uuid,
    nullif(payload->>'link_group_worker_id','')::uuid,
    nullif(payload->>'link_group_id','')::uuid,
    nullif(payload->>'event_id','')::uuid,
    nullif(payload->>'company_id','')::uuid,
    v_uid
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'result','ok',
    'qualification_id', v_new_id,
    'previous_qualification_id', v_prev,
    'revision_type', v_revision,
    'document_type_id', v_doc_type_id,
    'expires_at', v_expires,
    'expiry_source', v_expiry_source,
    'validity_days_used', v_validity_days_used
  );
END;
$function$;

-- 2) evaluate_link_compliance v3: precedência do cargo (validity_days_override)
--    aplica prazo efetivo = min(certificado, cargo_effective). Não altera calculate_compliance_overall.
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
    RETURN jsonb_build_object('schema_version', 3, 'error','link_not_found');
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
  -- Precedência: prazo efetivo = mais restritivo entre certificado e cargo override.
  resolved AS (
    SELECT e.*,
      e.expiry_date AS certificate_expiry,
      CASE
        WHEN e.category='sst_nr'
             AND e.validity_days_override IS NOT NULL
             AND e.validity_days_override > 0
             AND e.issue_date IS NOT NULL
        THEN (e.issue_date + (e.validity_days_override || ' days')::interval)::date
        ELSE NULL
      END AS role_effective_expiry
    FROM merged_docs e
  ),
  effective AS (
    SELECT r.*,
      CASE
        WHEN r.certificate_expiry IS NOT NULL AND r.role_effective_expiry IS NOT NULL
          THEN LEAST(r.certificate_expiry, r.role_effective_expiry)
        ELSE COALESCE(r.certificate_expiry, r.role_effective_expiry)
      END AS effective_expiry,
      CASE
        WHEN r.certificate_expiry IS NOT NULL AND r.role_effective_expiry IS NOT NULL
             AND r.role_effective_expiry < r.certificate_expiry THEN 'role_override'
        WHEN r.role_effective_expiry IS NOT NULL AND r.certificate_expiry IS NULL THEN 'role_override'
        WHEN r.certificate_expiry IS NOT NULL THEN 'certificate'
        ELSE 'none'
      END AS expiry_rule_source
    FROM resolved r
  ),
  scored AS (
    SELECT e.*,
      CASE
        WHEN e.category='sst_nr' THEN
          CASE
            WHEN e.worker_document_id IS NULL THEN NULL
            WHEN e.nr_validity_status = 'no_expiry' AND e.role_effective_expiry IS NULL THEN NULL
            WHEN e.effective_expiry IS NULL THEN NULL
            ELSE (e.effective_expiry - CURRENT_DATE)
          END
        ELSE
          CASE WHEN e.effective_expiry IS NOT NULL THEN (e.effective_expiry - CURRENT_DATE) ELSE NULL END
      END AS days_remaining,
      CASE
        WHEN e.worker_document_id IS NULL THEN 'missing'
        WHEN e.category='sst_nr' THEN
          CASE
            WHEN e.nr_validity_status = 'unknown' THEN 'pending'
            WHEN e.effective_expiry IS NOT NULL AND e.effective_expiry < CURRENT_DATE THEN 'expired'
            WHEN e.wd_status = 'pending' THEN 'pending'
            WHEN e.effective_expiry IS NOT NULL
                 AND e.effective_expiry <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
        ELSE
          CASE
            WHEN e.has_expiration AND e.effective_expiry IS NOT NULL AND e.effective_expiry < CURRENT_DATE THEN 'expired'
            WHEN e.wd_status = 'pending' THEN 'pending'
            WHEN e.requires_file AND (e.file_path IS NULL OR e.file_path='') THEN 'pending'
            WHEN e.has_expiration AND e.effective_expiry IS NOT NULL
                 AND e.effective_expiry <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
            ELSE 'ok'
          END
      END AS status
    FROM effective e
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
        WHEN 'expired' THEN 'Documento vencido em ' || to_char(s.effective_expiry,'DD/MM/YYYY')
        WHEN 'pending' THEN
          CASE WHEN s.requires_file AND (s.file_path IS NULL OR s.file_path='')
               THEN 'Documento aguardando anexo'
               ELSE 'Documento pendente de validação' END
        WHEN 'warning' THEN 'Vence em ' || s.days_remaining || ' dia(s), em ' || to_char(s.effective_expiry,'DD/MM/YYYY')
        WHEN 'ok' THEN
          CASE WHEN s.has_expiration AND s.effective_expiry IS NOT NULL
               THEN 'Válido até ' || to_char(s.effective_expiry,'DD/MM/YYYY')
               ELSE 'Documento válido' END
      END AS status_reason
    FROM scored s
  )
  SELECT jsonb_agg(
      jsonb_build_object(
        'document_type_id', document_type_id, 'code', code, 'name', name, 'category', category,
        'status', status, 'status_code', status,
        'status_label', status_label, 'status_reason', status_reason,
        -- Retorna o prazo efetivo em expires_at (compatibilidade + precedência aplicada).
        'expires_at', effective_expiry, 'days_remaining', days_remaining,
        'worker_document_id', worker_document_id,
        'is_mandatory', is_mandatory, 'required_by', required_by,
        'override_action', override_action,
        'display_order', display_order,
        -- Fase 1.5 — campos auxiliares para exibição/auditoria.
        'certificate_expiry', certificate_expiry,
        'role_effective_expiry', role_effective_expiry,
        'validity_days_override', validity_days_override,
        'effective_expiry', effective_expiry,
        'expiry_rule_source', expiry_rule_source,
        'reason_params', jsonb_build_object(
          'expiry_date', effective_expiry, 'days_remaining', days_remaining,
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
    'schema_version', 3,
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

REVOKE EXECUTE ON FUNCTION public.evaluate_link_compliance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_link_compliance(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.register_sst_revision(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_sst_revision(jsonb) TO authenticated, service_role;