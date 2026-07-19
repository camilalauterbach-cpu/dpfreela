
-- 1) State hash column on history
ALTER TABLE public.document_compliance_history
  ADD COLUMN IF NOT EXISTS state_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_dch_link_overall_created
  ON public.document_compliance_history(employment_link_id, entity_type, created_at DESC);

-- 2) Track last incremental check per link
ALTER TABLE public.employment_links
  ADD COLUMN IF NOT EXISTS last_compliance_check_at TIMESTAMPTZ NULL;

-- 3) Deterministic hash helper
CREATE OR REPLACE FUNCTION public.compute_compliance_state_hash(p_eval jsonb)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_lines TEXT := '';
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT
      COALESCE(d->>'code','') AS code,
      COALESCE(d->>'status','') AS status,
      COALESCE((d->>'display_order')::int, 9999) AS ord
    FROM jsonb_array_elements(COALESCE(p_eval->'documents','[]'::jsonb)) AS d
    ORDER BY 3, 1
  LOOP
    v_lines := v_lines || v_row.code || '=' || v_row.status || E'\n';
  END LOOP;
  v_lines := v_lines || 'overall=' || COALESCE(p_eval->>'overall','');
  RETURN md5(v_lines);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_compliance_state_hash(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_compliance_state_hash(jsonb) TO authenticated, service_role;

-- 4) Rewrite record_compliance_transitions with hash short-circuit
CREATE OR REPLACE FUNCTION public.record_compliance_transitions(
  p_link_id UUID,
  p_event_source TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval JSONB;
  v_worker_id UUID;
  v_current_overall TEXT;
  v_last_overall TEXT;
  v_last_hash TEXT;
  v_new_hash TEXT;
  v_doc JSONB;
  v_dt_id UUID;
  v_wd_id UUID;
  v_curr TEXT;
  v_prev TEXT;
  v_reason TEXT;
  v_actor UUID := auth.uid();
  v_inserted INT := 0;
  v_event_source TEXT;
  v_skipped BOOLEAN := false;
BEGIN
  v_event_source := COALESCE(p_event_source, 'system');
  IF v_event_source NOT IN ('upload','expiration','admin_update','job_role_change','migration','system','manual','reevaluate','api') THEN
    v_event_source := 'system';
  END IF;

  v_eval := public.evaluate_link_compliance(p_link_id);
  IF (v_eval->>'error') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_eval->>'error');
  END IF;

  v_worker_id := ((v_eval->'worker')->>'id')::uuid;
  v_current_overall := v_eval->>'overall';
  v_new_hash := public.compute_compliance_state_hash(v_eval);

  -- Short-circuit if latest overall row has identical hash
  SELECT current_status, state_hash
    INTO v_last_overall, v_last_hash
  FROM public.document_compliance_history
  WHERE employment_link_id = p_link_id
    AND entity_type = 'overall'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_hash IS NOT NULL AND v_last_hash = v_new_hash THEN
    v_skipped := true;
  ELSE
    -- Documents transitions
    FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(v_eval->'documents','[]'::jsonb))
    LOOP
      v_dt_id := (v_doc->>'document_type_id')::uuid;
      v_wd_id := NULLIF(v_doc->>'worker_document_id','')::uuid;
      v_curr := v_doc->>'status';
      v_reason := v_doc->>'status_reason';

      SELECT current_status INTO v_prev
      FROM public.document_compliance_history
      WHERE employment_link_id = p_link_id
        AND entity_type = 'document'
        AND document_type_id = v_dt_id
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_prev IS DISTINCT FROM v_curr THEN
        INSERT INTO public.document_compliance_history(
          employment_link_id, worker_id, worker_document_id, document_type_id,
          entity_type, previous_status, current_status, reason, event_source, changed_by, state_hash
        ) VALUES (
          p_link_id, v_worker_id, v_wd_id, v_dt_id,
          'document', v_prev, v_curr, v_reason, v_event_source, v_actor, v_new_hash
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;

    IF v_last_overall IS DISTINCT FROM v_current_overall OR v_last_hash IS NULL THEN
      INSERT INTO public.document_compliance_history(
        employment_link_id, worker_id, entity_type,
        previous_status, current_status, event_source, changed_by, state_hash
      ) VALUES (
        p_link_id, v_worker_id, 'overall',
        v_last_overall, v_current_overall, v_event_source, v_actor, v_new_hash
      );
      v_inserted := v_inserted + 1;
    END IF;
  END IF;

  UPDATE public.employment_links
     SET last_compliance_check_at = now()
   WHERE id = p_link_id;

  RETURN jsonb_build_object(
    'ok', true,
    'link_id', p_link_id,
    'overall', v_current_overall,
    'state_hash', v_new_hash,
    'skipped', v_skipped,
    'transitions_recorded', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_compliance_transitions(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_compliance_transitions(UUID, TEXT) TO authenticated, service_role;

-- 5) Transactional save of job role requirements + reevaluate all impacted links
CREATE OR REPLACE FUNCTION public.save_job_role_requirements(
  p_job_role_id UUID,
  p_requirements JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reev JSONB;
  v_inserted INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['admin'::public.app_role,'manager'::public.app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_job_role_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.job_role_document_requirements
   WHERE job_role_id = p_job_role_id;

  INSERT INTO public.job_role_document_requirements(
    job_role_id, document_type_id, is_mandatory,
    validity_days_override, display_order, required_by
  )
  SELECT
    p_job_role_id,
    (r->>'document_type_id')::uuid,
    COALESCE((r->>'is_mandatory')::boolean, true),
    NULLIF(r->>'validity_days_override','')::int,
    COALESCE((r->>'display_order')::int, 0),
    COALESCE(r->>'required_by','job_role')
  FROM jsonb_array_elements(COALESCE(p_requirements,'[]'::jsonb)) r
  WHERE (r->>'document_type_id') IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('job_role_document_requirements', p_job_role_id, 'requirements_updated',
          NULL,
          jsonb_build_object('count', v_inserted, 'requirements', p_requirements),
          v_uid);

  -- Same-transaction reevaluation
  v_reev := public.reevaluate_job_role_links(p_job_role_id, 'job_role_change');

  RETURN jsonb_build_object(
    'ok', true,
    'job_role_id', p_job_role_id,
    'requirements_saved', v_inserted,
    'reevaluation', v_reev
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_job_role_requirements(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_job_role_requirements(UUID, JSONB) TO authenticated, service_role;

-- 6) Incremental expiration job (skips links already checked today)
CREATE OR REPLACE FUNCTION public.run_compliance_expiration_job(
  p_warning_days INT DEFAULT 30,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_total INT := 0;
  v_transitions INT := 0;
  v_res JSONB;
BEGIN
  IF NOT (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role,'manager'::public.app_role])
          OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  FOR v_link IN
    SELECT DISTINCT el.id
      FROM public.employment_links el
      JOIN public.job_role_document_requirements r ON r.job_role_id = el.job_role_id
      JOIN public.document_types dt ON dt.id = r.document_type_id
      LEFT JOIN LATERAL (
        SELECT wd.expiry_date
          FROM public.worker_documents wd
         WHERE wd.worker_id = el.worker_id
           AND wd.document_type_id = r.document_type_id
           AND wd.deleted_at IS NULL
         ORDER BY wd.issue_date DESC NULLS LAST, wd.created_at DESC
         LIMIT 1
      ) ld ON true
     WHERE el.deleted_at IS NULL
       AND dt.is_active = true
       AND dt.has_expiration = true
       AND ld.expiry_date IS NOT NULL
       AND ld.expiry_date <= (CURRENT_DATE + (p_warning_days || ' days')::interval)::date
       AND (p_force
            OR el.last_compliance_check_at IS NULL
            OR el.last_compliance_check_at < CURRENT_DATE)
  LOOP
    v_res := public.record_compliance_transitions(v_link.id, 'expiration');
    v_total := v_total + 1;
    v_transitions := v_transitions + COALESCE((v_res->>'transitions_recorded')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'links_processed', v_total,
    'transitions_recorded', v_transitions,
    'run_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_compliance_expiration_job(INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_compliance_expiration_job(INT, BOOLEAN) TO authenticated, service_role;

-- 7) Simulate compliance without side effects
CREATE OR REPLACE FUNCTION public.simulate_link_compliance(
  p_link_id UUID,
  p_overrides JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_worker RECORD;
  v_role RECORD;
  v_warning_days INT := 30;
  v_docs JSONB;
  v_score JSONB;
  v_overall TEXT;
  v_required INT := 0;
  v_valid INT := 0;
  v_warning INT := 0;
  v_expired INT := 0;
  v_missing INT := 0;
  v_pending INT := 0;
  v_percent NUMERIC := 0;
  v_has_blocker BOOLEAN;
  v_has_attention BOOLEAN;
  v_remove_req UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'remove_requirement_type_ids','[]'::jsonb)))::uuid);
  v_add_req JSONB := COALESCE(p_overrides->'add_requirements','[]'::jsonb);
  v_add_docs JSONB := COALESCE(p_overrides->'add_worker_documents','[]'::jsonb);
  v_remove_docs UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'remove_worker_document_ids','[]'::jsonb)))::uuid);
  v_expire UUID[] := ARRAY(SELECT (jsonb_array_elements_text(COALESCE(p_overrides->'expire_document_type_ids','[]'::jsonb)))::uuid);
BEGIN
  SELECT el.id, el.worker_id, el.job_role_id
    INTO v_link FROM public.employment_links el WHERE el.id = p_link_id;
  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 1, 'error','link_not_found');
  END IF;

  SELECT w.id, w.full_name AS name INTO v_worker FROM public.workers w WHERE w.id = v_link.worker_id;
  SELECT jr.id, jr.name INTO v_role FROM public.job_roles jr WHERE jr.id = v_link.job_role_id;

  WITH base_reqs AS (
    SELECT r.document_type_id, dt.code, dt.name, dt.category,
           dt.has_expiration, dt.requires_file, dt.default_validity_days,
           r.is_mandatory, r.validity_days_override, r.display_order, r.required_by
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
  base_docs AS (
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
  latest_docs AS (
    SELECT * FROM base_docs
    UNION ALL
    SELECT * FROM sim_docs
     WHERE document_type_id NOT IN (SELECT document_type_id FROM base_docs)
  ),
  evaluated AS (
    SELECT
      reqs.document_type_id, reqs.code, reqs.name, reqs.category,
      reqs.is_mandatory, reqs.required_by, reqs.display_order,
      reqs.requires_file, reqs.has_expiration,
      ld.worker_document_id,
      CASE WHEN reqs.document_type_id = ANY(v_expire) THEN CURRENT_DATE - 1 ELSE ld.expiry_date END AS expiry_date,
      ld.file_path,
      CASE WHEN ld.expiry_date IS NOT NULL
        THEN ((CASE WHEN reqs.document_type_id = ANY(v_expire) THEN CURRENT_DATE - 1 ELSE ld.expiry_date END) - CURRENT_DATE)
        ELSE NULL END AS days_remaining,
      CASE
        WHEN ld.worker_document_id IS NULL AND NOT EXISTS (SELECT 1 FROM sim_docs s WHERE s.document_type_id = reqs.document_type_id) THEN 'missing'
        WHEN reqs.document_type_id = ANY(v_expire) THEN 'expired'
        WHEN reqs.has_expiration AND ld.expiry_date IS NOT NULL AND ld.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN ld.wd_status = 'pending' THEN 'pending'
        WHEN reqs.requires_file AND (ld.file_path IS NULL OR ld.file_path = '') THEN 'pending'
        WHEN reqs.has_expiration AND ld.expiry_date IS NOT NULL
             AND ld.expiry_date <= CURRENT_DATE + (v_warning_days || ' days')::interval THEN 'warning'
        ELSE 'ok'
      END AS status
    FROM reqs
    LEFT JOIN latest_docs ld ON ld.document_type_id = reqs.document_type_id
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
        'simulated', (worker_document_id IS NULL AND status <> 'missing')
      )
      ORDER BY
        CASE status WHEN 'missing' THEN 1 WHEN 'expired' THEN 2 WHEN 'pending' THEN 3 WHEN 'warning' THEN 4 WHEN 'ok' THEN 5 END,
        display_order, name
    ),
    COUNT(*) FILTER (WHERE is_mandatory),
    COUNT(*) FILTER (WHERE status = 'ok' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'warning' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'expired' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'missing' AND is_mandatory),
    COUNT(*) FILTER (WHERE status = 'pending' AND is_mandatory)
  INTO v_docs, v_required, v_valid, v_warning, v_expired, v_missing, v_pending
  FROM evaluated;

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
    'simulated', true,
    'overall', v_overall,
    'link_id', p_link_id,
    'worker', CASE WHEN v_worker.id IS NOT NULL THEN jsonb_build_object('id', v_worker.id, 'name', v_worker.name) ELSE NULL END,
    'job_role', CASE WHEN v_role.id IS NOT NULL THEN jsonb_build_object('id', v_role.id, 'name', v_role.name) ELSE NULL END,
    'score', v_score,
    'documents', COALESCE(v_docs, '[]'::jsonb),
    'evaluated_at', now(),
    'warning_days', v_warning_days,
    'applied_overrides', p_overrides
  );
END;
$$;

REVOKE ALL ON FUNCTION public.simulate_link_compliance(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulate_link_compliance(UUID, JSONB) TO authenticated, service_role;
