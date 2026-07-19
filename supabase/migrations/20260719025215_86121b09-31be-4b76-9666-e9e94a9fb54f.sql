-- Compliance list RPC (paginated, filterable)
CREATE OR REPLACE FUNCTION public.list_link_compliance(
  p_compliance text DEFAULT NULL,
  p_doc_code   text DEFAULT NULL,
  p_job_role_id uuid DEFAULT NULL,
  p_search     text DEFAULT NULL,
  p_limit      int  DEFAULT 100,
  p_offset     int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total int := 0;
  v_row record;
  v_eval jsonb;
  v_overall text;
  v_docs jsonb;
  v_has_doc boolean;
BEGIN
  FOR v_row IN
    SELECT el.id AS link_id,
           el.worker_id,
           el.job_role_id,
           w.full_name AS worker_name,
           jr.name AS job_role_name
    FROM public.employment_links el
    LEFT JOIN public.workers w ON w.id = el.worker_id
    LEFT JOIN public.job_roles jr ON jr.id = el.job_role_id
    WHERE el.deleted_at IS NULL
      AND (p_job_role_id IS NULL OR el.job_role_id = p_job_role_id)
      AND (
        p_search IS NULL OR p_search = ''
        OR w.full_name ILIKE '%' || p_search || '%'
        OR jr.name    ILIKE '%' || p_search || '%'
      )
    ORDER BY w.full_name NULLS LAST
  LOOP
    v_eval := public.evaluate_link_compliance(v_row.link_id);
    v_overall := v_eval->>'overall';
    v_docs := v_eval->'documents';

    IF p_compliance IS NOT NULL AND p_compliance <> '' AND v_overall <> p_compliance THEN
      CONTINUE;
    END IF;

    IF p_doc_code IS NOT NULL AND p_doc_code <> '' THEN
      SELECT EXISTS(
        SELECT 1 FROM jsonb_array_elements(v_docs) d
        WHERE d->>'code' = p_doc_code
      ) INTO v_has_doc;
      IF NOT v_has_doc THEN CONTINUE; END IF;
    END IF;

    v_total := v_total + 1;
    IF v_total > p_offset AND v_total <= (p_offset + p_limit) THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'link_id',       v_row.link_id,
        'worker_id',     v_row.worker_id,
        'worker_name',   v_row.worker_name,
        'job_role_id',   v_row.job_role_id,
        'job_role_name', v_row.job_role_name,
        'overall',       v_overall,
        'score',         v_eval->'score',
        'documents',     v_docs
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'generated_at', now(),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_link_compliance(text,text,uuid,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_link_compliance(text,text,uuid,text,int,int) TO authenticated, service_role;

-- Compliance evaluation audit event
CREATE OR REPLACE FUNCTION public.log_compliance_evaluation(
  p_link_id uuid,
  p_current_overall text,
  p_previous_overall text DEFAULT NULL,
  p_event_source text DEFAULT 'view'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  INSERT INTO public.change_logs (table_name, record_id, action, new_data, changed_by)
  VALUES (
    'employment_links',
    p_link_id,
    'compliance_evaluated',
    jsonb_build_object(
      'current_overall',  p_current_overall,
      'previous_overall', p_previous_overall,
      'event_source',     p_event_source,
      'evaluated_at',     now()
    ),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_compliance_evaluation(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_compliance_evaluation(uuid,text,text,text) TO authenticated, service_role;