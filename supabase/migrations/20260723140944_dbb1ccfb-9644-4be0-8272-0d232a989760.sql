
CREATE OR REPLACE FUNCTION public.resolve_worker_operational_contexts(
  p_worker_ids uuid[] DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_link_group_id uuid DEFAULT NULL,
  p_only_active boolean DEFAULT true
)
RETURNS TABLE (
  worker_id uuid,
  employment_link_id uuid,
  link_group_worker_id uuid,
  link_group_id uuid,
  event_id uuid,
  event_name text,
  job_role_id uuid,
  job_role_name text,
  context_source text,
  context_status text,
  hire_date date,
  end_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  formal AS (
    SELECT
      el.worker_id,
      el.id AS employment_link_id,
      NULL::uuid AS link_group_worker_id,
      NULL::uuid AS link_group_id,
      el.event_id,
      ev.name AS event_name,
      el.job_role_id,
      jr.name AS job_role_name,
      'formal_link'::text AS context_source,
      CASE
        WHEN el.status = 'active'
         AND (ev.id IS NULL OR (ev.deleted_at IS NULL AND ev.status <> 'completed'))
         AND (el.end_date IS NULL OR el.end_date >= current_date)
        THEN 'active' ELSE 'historical'
      END AS context_status,
      el.hire_date, el.end_date
    FROM public.employment_links el
    LEFT JOIN public.events ev ON ev.id = el.event_id
    LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
    WHERE el.deleted_at IS NULL
      AND (p_worker_ids IS NULL OR el.worker_id = ANY(p_worker_ids))
      AND (p_event_id IS NULL OR el.event_id = p_event_id)
  ),
  formal_filtered AS (
    SELECT * FROM formal
    WHERE (NOT p_only_active) OR context_status = 'active'
  ),
  legacy_raw AS (
    SELECT
      lgw.worker_id,
      lgw.id AS link_group_worker_id,
      lgw.link_group_id,
      lg.event_id,
      ev.name AS event_name,
      lgw.job_role_id AS explicit_job_role_id,
      lgw.job_role AS raw_job_role_text,
      lgw.status AS lgw_status,
      lgw.hire_date, lgw.end_date,
      lgw.employment_link_id AS bound_link_id,
      ev.status AS event_status,
      ev.deleted_at AS event_deleted_at,
      lg.deleted_at AS group_deleted_at
    FROM public.link_group_workers lgw
    JOIN public.link_groups lg ON lg.id = lgw.link_group_id
    LEFT JOIN public.events ev ON ev.id = lg.event_id
    WHERE lgw.deleted_at IS NULL
      AND (p_worker_ids IS NULL OR lgw.worker_id = ANY(p_worker_ids))
      AND (p_link_group_id IS NULL OR lgw.link_group_id = p_link_group_id)
      AND (p_event_id IS NULL OR lg.event_id = p_event_id)
  ),
  legacy_resolved AS (
    SELECT
      lr.*,
      COALESCE(
        (SELECT jr.id FROM public.job_roles jr
          WHERE jr.id = lr.explicit_job_role_id AND jr.is_active = true),
        (
          SELECT jr.id FROM public.job_roles jr
          WHERE jr.is_active = true
            AND lr.raw_job_role_text IS NOT NULL
            AND btrim(lower(jr.name)) = btrim(lower(lr.raw_job_role_text))
          GROUP BY jr.id
          HAVING (SELECT count(*) FROM public.job_roles jr2
                   WHERE jr2.is_active = true
                     AND btrim(lower(jr2.name)) = btrim(lower(lr.raw_job_role_text))) = 1
          LIMIT 1
        )
      ) AS resolved_job_role_id,
      CASE
        WHEN EXISTS(SELECT 1 FROM public.job_roles jr
                    WHERE jr.id = lr.explicit_job_role_id AND jr.is_active = true)
          THEN 'legacy_role_fk'
        WHEN lr.raw_job_role_text IS NOT NULL
         AND (SELECT count(*) FROM public.job_roles jr2
              WHERE jr2.is_active = true
                AND btrim(lower(jr2.name)) = btrim(lower(lr.raw_job_role_text))) = 1
          THEN 'legacy_exact_text_match'
        ELSE 'unresolved_role'
      END AS resolution_source
    FROM legacy_raw lr
  ),
  legacy AS (
    SELECT
      lrr.worker_id,
      NULL::uuid AS employment_link_id,
      lrr.link_group_worker_id,
      lrr.link_group_id,
      lrr.event_id,
      lrr.event_name,
      lrr.resolved_job_role_id AS job_role_id,
      (SELECT jr.name FROM public.job_roles jr WHERE jr.id = lrr.resolved_job_role_id) AS job_role_name,
      lrr.resolution_source AS context_source,
      CASE
        WHEN lrr.resolution_source = 'unresolved_role' THEN 'unresolved'
        WHEN lrr.lgw_status IN ('confirmed','in_progress')
         AND lrr.group_deleted_at IS NULL
         AND lrr.event_deleted_at IS NULL
         AND (lrr.event_status IS NULL OR lrr.event_status <> 'completed')
         AND (lrr.end_date IS NULL OR lrr.end_date >= current_date)
          THEN 'active'
        ELSE 'historical'
      END AS context_status,
      lrr.hire_date, lrr.end_date,
      lrr.bound_link_id
    FROM legacy_resolved lrr
  ),
  legacy_final AS (
    SELECT worker_id, employment_link_id, link_group_worker_id, link_group_id,
           event_id, event_name, job_role_id, job_role_name,
           context_source, context_status, hire_date, end_date
    FROM legacy l
    WHERE (l.bound_link_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM formal_filtered ff
                           WHERE ff.employment_link_id = l.bound_link_id))
      AND ((NOT p_only_active) OR l.context_status IN ('active','unresolved'))
  )
  SELECT * FROM formal_filtered
  UNION ALL
  SELECT * FROM legacy_final;
$$;

REVOKE ALL ON FUNCTION public.resolve_worker_operational_contexts(uuid[], uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_worker_operational_contexts(uuid[], uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_worker_operational_contexts(uuid[], uuid, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.resolve_worker_operational_contexts(uuid[], uuid, uuid, boolean) IS
  'Q-023 Fase 1: enumera contextos operacionais (formal ou legado) por trabalhador. Read-only.';

-- Fase 2
CREATE TABLE IF NOT EXISTS public.global_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_id uuid NOT NULL REFERENCES public.document_types(id) ON DELETE RESTRICT,
  applies_to_active_context boolean NOT NULL DEFAULT true,
  is_mandatory boolean NOT NULL DEFAULT true,
  allow_waive boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gdr_active
  ON public.global_document_requirements(document_type_id)
  WHERE deleted_at IS NULL AND is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.global_document_requirements TO authenticated;
GRANT ALL ON public.global_document_requirements TO service_role;

ALTER TABLE public.global_document_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gdr_admin_manager_manage"
  ON public.global_document_requirements FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

CREATE POLICY "gdr_operational_read"
  ON public.global_document_requirements FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'operator'::app_role)
    OR has_role(auth.uid(),'viewer'::app_role)
  );

CREATE TRIGGER trg_gdr_updated_at
  BEFORE UPDATE ON public.global_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
DECLARE
  v_aso_id uuid;
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.document_types
  WHERE btrim(upper(code)) = 'ASO' AND is_active = true;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Q-023 Fase 2: gate do ASO falhou. Esperado 1 document_type com code=ASO ativo; encontrado %.', v_count;
  END IF;

  SELECT id INTO v_aso_id
  FROM public.document_types
  WHERE btrim(upper(code)) = 'ASO' AND is_active = true
  LIMIT 1;

  INSERT INTO public.global_document_requirements
    (document_type_id, applies_to_active_context, is_mandatory, allow_waive, is_active, notes)
  VALUES
    (v_aso_id, true, true, false, true,
     'ASO obrigatório para todo contexto operacional ativo (Q-023 Fase 2).')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.change_logs (table_name, record_id, action, new_data, changed_by)
  VALUES (
    'global_document_requirements',
    v_aso_id,
    'create',
    jsonb_build_object(
      'source','Q-023 Fase 2',
      'document_type_id', v_aso_id,
      'is_mandatory', true,
      'allow_waive', false
    ),
    NULL
  );
END $$;
