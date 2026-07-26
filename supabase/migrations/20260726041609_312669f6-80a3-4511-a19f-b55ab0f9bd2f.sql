
-- 1) Audit trail table
CREATE TABLE public.worker_document_revision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  document_type_id uuid NOT NULL,
  revision_id uuid NULL,
  event text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  actor_id uuid NULL,
  idempotency_key uuid NULL,
  trace_id uuid NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_document_revision_events_event_chk
    CHECK (event IN (
      'upload_started','storage_uploaded','storage_upload_failed',
      'db_persisted','db_persist_failed',
      'became_current','superseded','idempotent_hit',
      'client_error','client_note'
    )),
  CONSTRAINT worker_document_revision_events_status_chk
    CHECK (status IN ('ok','error','warn'))
);

GRANT SELECT, INSERT ON public.worker_document_revision_events TO authenticated;
GRANT ALL ON public.worker_document_revision_events TO service_role;

ALTER TABLE public.worker_document_revision_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wdre_select_privileged"
  ON public.worker_document_revision_events
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role,'viewer'::app_role]));

CREATE POLICY "wdre_insert_privileged"
  ON public.worker_document_revision_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(),
      ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role])
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

CREATE INDEX idx_wdre_worker_type_time
  ON public.worker_document_revision_events (worker_id, document_type_id, occurred_at DESC);
CREATE INDEX idx_wdre_revision_time
  ON public.worker_document_revision_events (revision_id, occurred_at DESC);

-- 2) Client-facing RPC to log events emitted from the browser
CREATE OR REPLACE FUNCTION public.log_worker_document_revision_event(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_worker_id uuid;
  v_type_id uuid;
  v_event text;
  v_status text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_any_role(v_uid,
    ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_worker_id := NULLIF(p_payload->>'worker_id','')::uuid;
  v_type_id   := NULLIF(p_payload->>'document_type_id','')::uuid;
  v_event     := lower(COALESCE(NULLIF(p_payload->>'event',''),''));
  v_status    := lower(COALESCE(NULLIF(p_payload->>'status',''),'ok'));

  IF v_worker_id IS NULL OR v_type_id IS NULL OR v_event = '' THEN
    RAISE EXCEPTION 'worker_id_document_type_id_event_required' USING ERRCODE = '22004';
  END IF;

  INSERT INTO public.worker_document_revision_events (
    worker_id, document_type_id, revision_id, event, status, actor_id,
    idempotency_key, trace_id, details, occurred_at
  ) VALUES (
    v_worker_id, v_type_id,
    NULLIF(p_payload->>'revision_id','')::uuid,
    v_event, v_status, v_uid,
    NULLIF(p_payload->>'idempotency_key','')::uuid,
    NULLIF(p_payload->>'trace_id','')::uuid,
    COALESCE(p_payload->'details','{}'::jsonb),
    COALESCE(NULLIF(p_payload->>'occurred_at','')::timestamptz, now())
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_worker_document_revision_event(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.log_worker_document_revision_event(jsonb) TO authenticated;

-- 3) Instrument the canonical RPC to emit persistence / supersession / idempotent events.
--    Same body as the previous definition; only new INSERTs into the audit table are added.
CREATE OR REPLACE FUNCTION public.register_worker_document_revision(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_worker_id uuid;
  v_type_id uuid;
  v_operation text;
  v_expected_current uuid;
  v_idem uuid;
  v_file_path text;
  v_file_name text;
  v_file_size bigint;
  v_mime text;
  v_issued_at date;
  v_explicit_expiry date;
  v_doc_number text;
  v_authority text;
  v_notes text;
  v_reason text;
  v_status text;
  v_lock_key bigint;
  v_type public.document_types%ROWTYPE;
  v_worker_exists boolean;
  v_prev public.worker_documents%ROWTYPE;
  v_new public.worker_documents%ROWTYPE;
  v_existing_idem public.worker_documents%ROWTYPE;
  v_computed_expiry date;
  v_snapshot jsonb;
  v_expiry_source text;
  v_lock_wait_started_at timestamptz;
  v_lock_acquired_at timestamptz;
  v_lock_wait_ms numeric;
  v_lock_duration_ms numeric;
  v_trace_id uuid := gen_random_uuid();
  v_existing_fp jsonb;
  v_new_fp jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_any_role(v_uid, ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_worker_id        := NULLIF(p_payload->>'worker_id','')::uuid;
  v_type_id          := NULLIF(p_payload->>'document_type_id','')::uuid;
  v_operation        := lower(COALESCE(NULLIF(p_payload->>'operation',''),'initial'));
  v_expected_current := NULLIF(p_payload->>'expected_current_document_id','')::uuid;
  v_idem             := NULLIF(p_payload->>'idempotency_key','')::uuid;
  v_file_path        := NULLIF(p_payload->>'file_path','');
  v_file_name        := NULLIF(p_payload->>'file_name','');
  v_file_size        := NULLIF(p_payload->>'file_size','')::bigint;
  v_mime             := NULLIF(p_payload->>'mime_type','');
  v_issued_at        := NULLIF(p_payload->>'issued_at','')::date;
  v_explicit_expiry  := NULLIF(p_payload->>'explicit_expires_at','')::date;
  v_doc_number       := NULLIF(p_payload->>'document_number','');
  v_authority        := NULLIF(p_payload->>'issuing_authority','');
  v_notes            := NULLIF(p_payload->>'notes','');
  v_reason           := NULLIF(p_payload->>'revision_reason','');
  v_status           := COALESCE(NULLIF(p_payload->>'status',''), 'uploaded');

  IF v_worker_id IS NULL OR v_type_id IS NULL THEN
    RAISE EXCEPTION 'worker_id_and_document_type_id_required' USING ERRCODE = '22004';
  END IF;

  IF v_operation = 'replace' THEN
    v_operation := 'replacement';
  ELSIF v_operation = 'renew' THEN
    v_operation := 'renewal';
  END IF;

  IF v_operation NOT IN ('initial','renewal','replacement','correction') THEN
    RAISE EXCEPTION 'invalid_operation: %', v_operation USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('pending','uploaded','approved','rejected','replace') THEN
    RAISE EXCEPTION 'invalid_status: %', v_status USING ERRCODE = '22023';
  END IF;

  IF v_operation IN ('replacement','correction') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'revision_reason_required_for_%', v_operation USING ERRCODE = '22004';
  END IF;

  IF v_idem IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22004';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = v_worker_id AND w.deleted_at IS NULL
  ) INTO v_worker_exists;
  IF NOT v_worker_exists THEN
    RAISE EXCEPTION 'worker_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_type FROM public.document_types WHERE id = v_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_type.storage_scope IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'storage_scope_mismatch: worker required' USING ERRCODE = '42501';
  END IF;

  IF v_type.category IN ('sst_nr','training') THEN
    RAISE EXCEPTION 'document_type_must_use_sst_revision' USING ERRCODE = '42501',
      HINT = 'NRs e treinamentos devem ser registrados por register_sst_revision.';
  END IF;

  IF v_operation = 'initial' AND NOT COALESCE(v_type.is_active,false) THEN
    RAISE EXCEPTION 'document_type_inactive' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_type.requires_file,false) AND v_file_path IS NULL THEN
    RAISE EXCEPTION 'file_required' USING ERRCODE = '22004';
  END IF;

  IF v_type.validity_mode::text = 'fixed_duration' AND v_explicit_expiry IS NOT NULL THEN
    RAISE EXCEPTION 'explicit_expiry_not_allowed_for_fixed_duration' USING ERRCODE = '22023';
  END IF;

  IF v_type.validity_mode::text IN ('fixed_duration','explicit_date') AND v_issued_at IS NULL THEN
    RAISE EXCEPTION 'issued_at_required_for_%', v_type.validity_mode USING ERRCODE = '22004';
  END IF;

  IF v_type.validity_mode::text = 'explicit_date' AND v_explicit_expiry IS NULL THEN
    RAISE EXCEPTION 'explicit_expires_at_required_for_explicit_date' USING ERRCODE = '22004';
  END IF;

  v_lock_key := hashtextextended('wd_rev:'||v_worker_id::text||':'||v_type_id::text, 0);
  v_lock_wait_started_at := clock_timestamp();
  RAISE LOG 'register_worker_document_revision: waiting advisory lock trace=% worker=% type=% key=%',
    v_trace_id, v_worker_id, v_type_id, v_lock_key;

  PERFORM pg_advisory_xact_lock(v_lock_key);
  v_lock_acquired_at := clock_timestamp();
  v_lock_wait_ms := EXTRACT(EPOCH FROM (v_lock_acquired_at - v_lock_wait_started_at)) * 1000;

  RAISE LOG 'register_worker_document_revision: lock_acquired trace=% worker=% type=% key=% wait_ms=%',
    v_trace_id, v_worker_id, v_type_id, v_lock_key, v_lock_wait_ms;

  v_new_fp := jsonb_build_object(
    'worker_id',           v_worker_id,
    'document_type_id',    v_type_id,
    'operation',           v_operation,
    'file_path',           v_file_path,
    'file_name',           v_file_name,
    'file_size',           v_file_size,
    'mime_type',           v_mime,
    'issued_at',           v_issued_at,
    'explicit_expires_at', v_explicit_expiry,
    'document_number',     v_doc_number,
    'issuing_authority',   v_authority,
    'notes',               v_notes,
    'revision_reason',     v_reason,
    'status',              v_status
  );

  SELECT * INTO v_existing_idem
  FROM public.worker_documents
  WHERE idempotency_key = v_idem;

  IF FOUND THEN
    v_existing_fp := jsonb_build_object(
      'worker_id',           v_existing_idem.worker_id,
      'document_type_id',    v_existing_idem.document_type_id,
      'operation',           v_existing_idem.revision_type,
      'file_path',           v_existing_idem.file_path,
      'file_name',           v_existing_idem.file_name,
      'file_size',           v_existing_idem.file_size,
      'mime_type',           v_existing_idem.mime_type,
      'issued_at',           v_existing_idem.issue_date,
      'explicit_expires_at', NULLIF(v_existing_idem.validity_rule_snapshot->>'explicit_expires_at','')::date,
      'document_number',     v_existing_idem.document_number,
      'issuing_authority',   v_existing_idem.issuing_authority,
      'notes',               v_existing_idem.notes,
      'revision_reason',     v_existing_idem.revision_reason,
      'status',              v_existing_idem.status
    );

    IF v_existing_fp = v_new_fp THEN
      RAISE LOG 'register_worker_document_revision: idempotent_hit trace=% worker=% type=% revision=% wait_ms=%',
        v_trace_id, v_worker_id, v_type_id, v_existing_idem.id, v_lock_wait_ms;

      INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
      VALUES (
        'worker_documents', v_existing_idem.id, 'revision.idempotent_hit', NULL,
        jsonb_build_object(
          'trace_id', v_trace_id,
          'worker_id', v_worker_id,
          'document_type_id', v_type_id,
          'revision_id', v_existing_idem.id,
          'idempotency_key', v_idem,
          'operation', v_operation,
          'lock_wait_ms', v_lock_wait_ms
        ),
        v_uid
      );

      INSERT INTO public.worker_document_revision_events(
        worker_id, document_type_id, revision_id, event, status,
        actor_id, idempotency_key, trace_id, details
      ) VALUES (
        v_worker_id, v_type_id, v_existing_idem.id, 'idempotent_hit', 'ok',
        v_uid, v_idem, v_trace_id,
        jsonb_build_object(
          'operation', v_operation,
          'lock_wait_ms', v_lock_wait_ms
        )
      );

      RETURN jsonb_build_object(
        'idempotent_hit', true,
        'document', to_jsonb(v_existing_idem),
        'trace_id', v_trace_id,
        'lock_wait_ms', v_lock_wait_ms
      );
    END IF;

    RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_prev
  FROM public.worker_documents
  WHERE worker_id = v_worker_id
    AND document_type_id = v_type_id
    AND revision_managed = true
    AND is_current = true
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_operation = 'initial' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'current_revision_already_exists' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_current_to_supersede' USING ERRCODE = 'P0002';
    END IF;
    IF v_expected_current IS NULL OR v_expected_current <> v_prev.id THEN
      RAISE EXCEPTION 'stale_current_worker_document' USING ERRCODE = '40001';
    END IF;
  END IF;

  v_computed_expiry := public.calculate_document_expiry(
    v_issued_at, v_type.validity_mode, v_type.validity_value, v_type.validity_unit, v_explicit_expiry
  );

  v_expiry_source := CASE
    WHEN v_type.validity_mode::text = 'no_expiry' THEN 'no_expiry'
    WHEN v_type.validity_mode::text = 'explicit_date' THEN 'explicit'
    WHEN v_type.validity_mode::text = 'fixed_duration' THEN 'computed'
    WHEN v_computed_expiry IS NULL THEN 'unknown'
    ELSE 'derived'
  END;

  v_snapshot := jsonb_build_object(
    'validity_mode',       v_type.validity_mode,
    'validity_value',      v_type.validity_value,
    'validity_unit',       v_type.validity_unit,
    'issued_at',           v_issued_at,
    'explicit_expires_at', v_explicit_expiry,
    'computed_expiry',     v_computed_expiry,
    'expiry_source',       v_expiry_source,
    'computed_at',         now()
  );

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.worker_documents
       SET is_current = false, superseded_at = now(), updated_at = now()
     WHERE id = v_prev.id;

    INSERT INTO public.worker_document_revision_events(
      worker_id, document_type_id, revision_id, event, status,
      actor_id, idempotency_key, trace_id, details
    ) VALUES (
      v_worker_id, v_type_id, v_prev.id, 'superseded', 'ok',
      v_uid, v_idem, v_trace_id,
      jsonb_build_object(
        'operation', v_operation,
        'superseded_at', now()
      )
    );
  END IF;

  INSERT INTO public.worker_documents (
    worker_id, document_type_id, document_type, category, status,
    file_path, file_name, file_size, mime_type,
    issue_date, expiry_date, document_number, issuing_authority, notes,
    is_current, revision_managed, revision_type, revision_reason,
    supersedes_id, idempotency_key, expiry_source, validity_rule_snapshot,
    created_by
  ) VALUES (
    v_worker_id, v_type_id, v_type.code, v_type.category, v_status,
    v_file_path, v_file_name, v_file_size, v_mime,
    v_issued_at,
    CASE WHEN v_type.validity_mode::text = 'no_expiry' THEN NULL ELSE v_computed_expiry END,
    v_doc_number, v_authority, v_notes,
    true, true, v_operation, v_reason,
    v_prev.id, v_idem, v_expiry_source, v_snapshot,
    v_uid
  ) RETURNING * INTO v_new;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'worker_documents',
    v_new.id,
    'revision.'||v_operation,
    CASE WHEN v_prev.id IS NOT NULL THEN to_jsonb(v_prev) ELSE NULL END,
    to_jsonb(v_new) || jsonb_build_object('trace_id', v_trace_id, 'lock_wait_ms', v_lock_wait_ms),
    v_uid
  );

  INSERT INTO public.worker_document_revision_events(
    worker_id, document_type_id, revision_id, event, status,
    actor_id, idempotency_key, trace_id, details
  ) VALUES
    (
      v_worker_id, v_type_id, v_new.id, 'db_persisted', 'ok',
      v_uid, v_idem, v_trace_id,
      jsonb_build_object(
        'operation', v_operation,
        'status', v_status,
        'file_path', v_file_path,
        'file_name', v_file_name,
        'file_size', v_file_size,
        'mime_type', v_mime,
        'issued_at', v_issued_at,
        'expiry_date', v_new.expiry_date,
        'expiry_source', v_expiry_source,
        'supersedes_id', v_prev.id,
        'lock_wait_ms', v_lock_wait_ms
      )
    ),
    (
      v_worker_id, v_type_id, v_new.id, 'became_current', 'ok',
      v_uid, v_idem, v_trace_id,
      jsonb_build_object(
        'operation', v_operation,
        'became_current_at', v_new.created_at,
        'supersedes_id', v_prev.id
      )
    );

  v_lock_duration_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_lock_acquired_at)) * 1000;

  RAISE LOG 'register_worker_document_revision: revision_ready_to_commit trace=% worker=% type=% revision=% op=% wait_ms=% held_ms=%',
    v_trace_id, v_worker_id, v_type_id, v_new.id, v_operation, v_lock_wait_ms, v_lock_duration_ms;

  RETURN jsonb_build_object(
    'idempotent_hit', false,
    'document', to_jsonb(v_new),
    'trace_id', v_trace_id,
    'lock_wait_ms', v_lock_wait_ms,
    'lock_held_ms', v_lock_duration_ms
  );
END;
$function$;
