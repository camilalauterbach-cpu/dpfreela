
-- =========================================================================
-- E-SST.1C — Exceções documentais por vínculo
-- =========================================================================

-- 1) Extend event_source and add override_action to history
ALTER TABLE public.document_compliance_history
  DROP CONSTRAINT IF EXISTS document_compliance_history_event_source_check;
ALTER TABLE public.document_compliance_history
  ADD CONSTRAINT document_compliance_history_event_source_check
  CHECK (event_source = ANY (ARRAY[
    'upload','expiration','admin_update','job_role_change',
    'migration','system','manual','reevaluate','link_override'
  ]));

ALTER TABLE public.document_compliance_history
  ADD COLUMN IF NOT EXISTS override_action text;

ALTER TABLE public.document_compliance_history
  DROP CONSTRAINT IF EXISTS document_compliance_history_override_action_check;
ALTER TABLE public.document_compliance_history
  ADD CONSTRAINT document_compliance_history_override_action_check
  CHECK (override_action IS NULL OR override_action = ANY (ARRAY['add','waive','delete']));

-- 2) Enum type for override action
DO $$ BEGIN
  CREATE TYPE public.link_document_override_action AS ENUM ('add','waive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Overrides table
CREATE TABLE IF NOT EXISTS public.employment_link_document_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_link_id uuid NOT NULL REFERENCES public.employment_links(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.document_types(id) ON DELETE RESTRICT,
  action public.link_document_override_action NOT NULL,
  required_until date,
  reason text,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elo_waive_no_required_until
    CHECK (action <> 'waive' OR required_until IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS employment_link_document_overrides_unique_active
  ON public.employment_link_document_overrides(employment_link_id, document_type_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS employment_link_document_overrides_link_idx
  ON public.employment_link_document_overrides(employment_link_id)
  WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employment_link_document_overrides TO authenticated;
GRANT ALL ON public.employment_link_document_overrides TO service_role;

ALTER TABLE public.employment_link_document_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "elo_select_authenticated" ON public.employment_link_document_overrides;
CREATE POLICY "elo_select_authenticated"
  ON public.employment_link_document_overrides
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "elo_admin_manager_all" ON public.employment_link_document_overrides;
CREATE POLICY "elo_admin_manager_all"
  ON public.employment_link_document_overrides
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

DROP TRIGGER IF EXISTS trg_elo_updated_at ON public.employment_link_document_overrides;
CREATE TRIGGER trg_elo_updated_at
  BEFORE UPDATE ON public.employment_link_document_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 4) Refactor evaluate_link_compliance to apply overrides
-- =========================================================================
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
           q.expiry_date,
           q.issued_at AS issue_date,
           'approved' AS wd_status,
           q.certificate_file_path AS file_path,
           q.validity_status AS nr_validity_status
      FROM public.worker_sst_qualifications_current q
     WHERE q.worker_id = v_link.worker_id
  ),
  merged_docs AS (
    -- NR: exclusively from qualifications
    SELECT r.*, n.worker_document_id, n.expiry_date, n.issue_date,
           n.wd_status, n.file_path, n.nr_validity_status
      FROM reqs r
      LEFT JOIN latest_nr n ON n.document_type_id = r.document_type_id
     WHERE r.category = 'sst_nr'
    UNION ALL
    -- Others: worker_documents -> fallback employment_link_documents
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
  evaluated AS (
    SELECT * FROM merged_docs
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

-- =========================================================================
-- 5) Refactor simulate_link_compliance to include link overrides + applied_overrides
-- =========================================================================
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
    jsonb_build_object(
      'id', o.id, 'document_type_id', o.document_type_id,
      'action', o.action, 'required_until', o.required_until, 'reason', o.reason
    )
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
           q.expiry_date, q.issued_at AS issue_date,
           'approved' AS wd_status, q.certificate_file_path AS file_path,
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
    'schema_version', 2,
    'simulated', true,
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

-- =========================================================================
-- 6) Admin RPC: save_link_document_override (create / update / soft-delete)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.save_link_document_override(
  p_employment_link_id uuid,
  p_document_type_id uuid,
  p_action text,               -- 'add' | 'waive' | 'delete'
  p_required_until date DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_override_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.employment_link_document_overrides%ROWTYPE;
  v_effective_action text := p_action;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_user,'admin') OR public.has_role(v_user,'manager')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('add','waive','delete') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'waive' AND p_required_until IS NOT NULL THEN
    RAISE EXCEPTION 'waive_cannot_have_required_until' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'delete' THEN
    UPDATE public.employment_link_document_overrides
       SET deleted_at = now(), deleted_by = v_user, updated_by = v_user
     WHERE (
             (p_override_id IS NOT NULL AND id = p_override_id)
             OR
             (p_override_id IS NULL
              AND employment_link_id = p_employment_link_id
              AND document_type_id = p_document_type_id)
           )
       AND deleted_at IS NULL
     RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'override_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT * INTO v_row FROM public.employment_link_document_overrides
     WHERE employment_link_id = p_employment_link_id
       AND document_type_id = p_document_type_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF v_row.id IS NOT NULL THEN
      UPDATE public.employment_link_document_overrides
         SET action = p_action::public.link_document_override_action,
             required_until = CASE WHEN p_action='waive' THEN NULL ELSE p_required_until END,
             reason = p_reason,
             updated_by = v_user
       WHERE id = v_row.id
       RETURNING * INTO v_row;
    ELSE
      INSERT INTO public.employment_link_document_overrides
        (employment_link_id, document_type_id, action, required_until, reason, created_by, updated_by)
      VALUES
        (p_employment_link_id, p_document_type_id,
         p_action::public.link_document_override_action,
         CASE WHEN p_action='waive' THEN NULL ELSE p_required_until END,
         p_reason, v_user, v_user)
      RETURNING * INTO v_row;
    END IF;
  END IF;

  -- Re-evaluate + record transitions
  PERFORM public.record_compliance_transitions(p_employment_link_id, 'link_override');

  -- Tag freshly inserted history rows with override_action for audit
  UPDATE public.document_compliance_history h
     SET override_action = v_effective_action
   WHERE h.employment_link_id = p_employment_link_id
     AND h.event_source = 'link_override'
     AND h.override_action IS NULL
     AND h.created_at >= now() - interval '5 seconds';

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_effective_action,
    'override', to_jsonb(v_row),
    'compliance', public.evaluate_link_compliance(p_employment_link_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_link_document_override(uuid,uuid,text,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_link_document_override(uuid,uuid,text,date,text,uuid) TO authenticated;
