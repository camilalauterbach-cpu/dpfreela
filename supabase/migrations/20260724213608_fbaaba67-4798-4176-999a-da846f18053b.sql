
DO $$
DECLARE
  v_worker uuid := '40ea1d66-1cbc-4ebc-a716-45dacfeb3c54';
  v_doctype uuid := '4a4dced4-1ce3-4561-b361-e0ee497bfa45';
  v_current uuid := '69830e4d-3464-49e1-b05b-f84a3a8f3dd0';
  v_previous uuid := '6c7d5b6c-c48b-48ca-b2a5-79d750c7d523';
  v_current_created timestamptz;
  v_prev_supersedes uuid;
  v_curr_supersedes uuid;
  v_curr_superseded timestamptz;
  v_prev_superseded timestamptz;
  v_before jsonb;
  v_after  jsonb;
  v_dup_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || '|' || v_doctype::text, 42)
  );

  SELECT created_at, supersedes_id, superseded_at
    INTO v_current_created, v_curr_supersedes, v_curr_superseded
    FROM public.worker_sst_qualifications
   WHERE id = v_current FOR UPDATE;

  SELECT supersedes_id, superseded_at
    INTO v_prev_supersedes, v_prev_superseded
    FROM public.worker_sst_qualifications
   WHERE id = v_previous FOR UPDATE;

  IF v_curr_supersedes IS DISTINCT FROM v_previous THEN
    RAISE EXCEPTION 'ambiguous_qualification_revision_chain: current.supersedes_id != previous.id';
  END IF;
  IF v_curr_superseded IS NOT NULL OR v_prev_superseded IS NOT NULL THEN
    -- idempotent: already reconciled
    RETURN;
  END IF;

  IF (SELECT count(*) FROM public.worker_sst_qualifications
        WHERE worker_id = v_worker
          AND document_type_id = v_doctype
          AND superseded_at IS NULL
          AND deleted_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'ambiguous_qualification_revision_chain: active count != 2';
  END IF;

  v_before := jsonb_build_object(
    'previous', jsonb_build_object('id', v_previous, 'superseded_at', v_prev_superseded, 'supersedes_id', v_prev_supersedes),
    'current',  jsonb_build_object('id', v_current,  'superseded_at', v_curr_superseded,  'supersedes_id', v_curr_supersedes)
  );

  UPDATE public.worker_sst_qualifications
     SET superseded_at = v_current_created,
         updated_at = now()
   WHERE id = v_previous AND superseded_at IS NULL;

  v_after := jsonb_build_object(
    'previous', jsonb_build_object('id', v_previous, 'superseded_at', v_current_created, 'supersedes_id', v_prev_supersedes),
    'current',  jsonb_build_object('id', v_current,  'superseded_at', NULL,              'supersedes_id', v_previous)
  );

  INSERT INTO public.change_logs (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'worker_sst_qualifications',
    v_previous,
    'reconcile_duplicate_qualification_chain',
    v_before,
    jsonb_build_object(
      'worker_id', v_worker,
      'document_type_id', v_doctype,
      'previous_revision_id', v_previous,
      'current_revision_id',  v_current,
      'decision_basis', 'explicit_supersedes',
      'reason', 'human_authorized_q024_nr35_duplicate',
      'authorized_by', 'human_authorized_q024',
      'before', v_before,
      'after',  v_after
    ),
    NULL
  );

  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT worker_id, document_type_id
      FROM public.worker_sst_qualifications
     WHERE superseded_at IS NULL
       AND deleted_at IS NULL
       AND document_type_id IS NOT NULL
     GROUP BY worker_id, document_type_id
    HAVING count(*) > 1
  ) d;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'global_duplicates_remaining: % pair(s) still have >1 active revision', v_dup_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'uq_worker_sst_current_worker_document_type'
  ) THEN
    CREATE UNIQUE INDEX uq_worker_sst_current_worker_document_type
      ON public.worker_sst_qualifications (worker_id, document_type_id)
      WHERE superseded_at IS NULL
        AND deleted_at IS NULL
        AND document_type_id IS NOT NULL;
  END IF;
END $$;
