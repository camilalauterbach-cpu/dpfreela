
CREATE OR REPLACE FUNCTION public.record_compliance_transitions(p_link_id uuid, p_event_source text DEFAULT 'system'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF v_event_source NOT IN ('upload','expiration','admin_update','job_role_change','migration','system','manual','reevaluate','api','link_override') THEN
    v_event_source := 'system';
  END IF;

  v_eval := public.evaluate_link_compliance(p_link_id);
  IF (v_eval->>'error') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_eval->>'error');
  END IF;

  v_worker_id := ((v_eval->'worker')->>'id')::uuid;
  v_current_overall := v_eval->>'overall';
  v_new_hash := public.compute_compliance_state_hash(v_eval);

  SELECT current_status, state_hash INTO v_last_overall, v_last_hash
  FROM public.document_compliance_history
  WHERE employment_link_id = p_link_id AND entity_type = 'overall'
  ORDER BY created_at DESC LIMIT 1;

  IF v_last_hash IS NOT NULL AND v_last_hash = v_new_hash THEN
    v_skipped := true;
  ELSE
    FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(v_eval->'documents','[]'::jsonb))
    LOOP
      v_dt_id := (v_doc->>'document_type_id')::uuid;
      v_wd_id := NULLIF(v_doc->>'worker_document_id','')::uuid;
      v_curr := v_doc->>'status';
      v_reason := v_doc->>'status_reason';

      SELECT current_status INTO v_prev
      FROM public.document_compliance_history
      WHERE employment_link_id = p_link_id
        AND entity_type = 'document' AND document_type_id = v_dt_id
      ORDER BY created_at DESC LIMIT 1;

      IF v_prev IS DISTINCT FROM v_curr THEN
        INSERT INTO public.document_compliance_history(
          employment_link_id, worker_id, worker_document_id, document_type_id,
          entity_type, previous_status, current_status, reason,
          event_source, changed_by, state_hash
        ) VALUES (
          p_link_id, v_worker_id, v_wd_id, v_dt_id,
          'document', v_prev, v_curr, v_reason,
          v_event_source, v_actor, NULL
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;

    IF v_last_overall IS DISTINCT FROM v_current_overall OR v_last_hash IS NULL THEN
      INSERT INTO public.document_compliance_history(
        employment_link_id, worker_id, entity_type,
        previous_status, current_status, reason,
        event_source, changed_by, state_hash
      ) VALUES (
        p_link_id, v_worker_id, 'overall',
        v_last_overall, v_current_overall,
        'Transição do overall do vínculo',
        v_event_source, v_actor, v_new_hash
      );
      v_inserted := v_inserted + 1;
    END IF;
  END IF;

  UPDATE public.employment_links SET last_compliance_check_at = now() WHERE id = p_link_id;

  RETURN jsonb_build_object(
    'ok', true, 'inserted', v_inserted, 'skipped', v_skipped,
    'overall', v_current_overall, 'state_hash', v_new_hash,
    'event_source', v_event_source
  );
END;
$function$;
