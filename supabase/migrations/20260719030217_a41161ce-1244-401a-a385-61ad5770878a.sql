
-- Entrega 13: document_compliance_history (transições apenas)

CREATE TABLE IF NOT EXISTS public.document_compliance_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employment_link_id UUID NOT NULL REFERENCES public.employment_links(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  worker_document_id UUID NULL REFERENCES public.worker_documents(id) ON DELETE SET NULL,
  document_type_id UUID NULL REFERENCES public.document_types(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('document','overall')),
  previous_status TEXT NULL,
  current_status TEXT NOT NULL,
  reason TEXT NULL,
  event_source TEXT NOT NULL CHECK (event_source IN ('upload','expiration','admin_update','job_role_change','migration','system','manual','reevaluate')),
  changed_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_compliance_history TO authenticated;
GRANT ALL ON public.document_compliance_history TO service_role;

ALTER TABLE public.document_compliance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read compliance history"
  ON public.document_compliance_history FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dch_link_created
  ON public.document_compliance_history(employment_link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dch_worker_created
  ON public.document_compliance_history(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dch_link_entity
  ON public.document_compliance_history(employment_link_id, entity_type, document_type_id, created_at DESC);

-- RPC: registra apenas transições reais
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
  v_doc JSONB;
  v_dt_id UUID;
  v_wd_id UUID;
  v_curr TEXT;
  v_prev TEXT;
  v_reason TEXT;
  v_actor UUID := auth.uid();
  v_inserted INT := 0;
  v_event_source TEXT;
BEGIN
  v_event_source := COALESCE(p_event_source, 'system');
  IF v_event_source NOT IN ('upload','expiration','admin_update','job_role_change','migration','system','manual','reevaluate') THEN
    v_event_source := 'system';
  END IF;

  v_eval := public.evaluate_link_compliance(p_link_id);
  IF (v_eval->>'error') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_eval->>'error');
  END IF;

  v_worker_id := ((v_eval->'worker')->>'id')::uuid;
  v_current_overall := v_eval->>'overall';

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
        entity_type, previous_status, current_status, reason, event_source, changed_by
      ) VALUES (
        p_link_id, v_worker_id, v_wd_id, v_dt_id,
        'document', v_prev, v_curr, v_reason, v_event_source, v_actor
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Overall transition
  SELECT current_status INTO v_last_overall
  FROM public.document_compliance_history
  WHERE employment_link_id = p_link_id
    AND entity_type = 'overall'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_overall IS DISTINCT FROM v_current_overall THEN
    INSERT INTO public.document_compliance_history(
      employment_link_id, worker_id, entity_type,
      previous_status, current_status, event_source, changed_by
    ) VALUES (
      p_link_id, v_worker_id, 'overall',
      v_last_overall, v_current_overall, v_event_source, v_actor
    );
    v_inserted := v_inserted + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'link_id', p_link_id,
    'overall', v_current_overall,
    'transitions_recorded', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_compliance_transitions(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_compliance_transitions(UUID, TEXT) TO authenticated, service_role;

-- RPC: reavaliar todos os vínculos afetados por mudança de requisitos do cargo
CREATE OR REPLACE FUNCTION public.reevaluate_job_role_links(
  p_job_role_id UUID,
  p_event_source TEXT DEFAULT 'job_role_change'
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
$$;

REVOKE ALL ON FUNCTION public.reevaluate_job_role_links(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reevaluate_job_role_links(UUID, TEXT) TO authenticated, service_role;

-- RPC: reavaliar todos os vínculos ativos de um trabalhador (após upload/exclusão)
CREATE OR REPLACE FUNCTION public.reevaluate_worker_links(
  p_worker_id UUID,
  p_event_source TEXT DEFAULT 'upload'
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
$$;

REVOKE ALL ON FUNCTION public.reevaluate_worker_links(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reevaluate_worker_links(UUID, TEXT) TO authenticated, service_role;

-- RPC: timeline consumível pela UI
CREATE OR REPLACE FUNCTION public.get_link_compliance_timeline(
  p_link_id UUID,
  p_limit INT DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
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
$$;

REVOKE ALL ON FUNCTION public.get_link_compliance_timeline(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_link_compliance_timeline(UUID, INT) TO authenticated, service_role;
