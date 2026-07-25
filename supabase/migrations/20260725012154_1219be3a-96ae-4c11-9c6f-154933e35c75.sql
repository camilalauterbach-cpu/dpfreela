CREATE OR REPLACE FUNCTION public.register_worker_document_revision(
  p_worker_id uuid,
  p_document_type_id uuid,
  p_file_path text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_file_size bigint DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_issue_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_document_number text DEFAULT NULL,
  p_issuing_authority text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_status text DEFAULT 'approved'
)
RETURNS public.worker_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type document_types%ROWTYPE;
  v_prev public.worker_documents%ROWTYPE;
  v_new public.worker_documents%ROWTYPE;
  v_uid uuid := auth.uid();
  v_lock_key bigint;
  v_status text := COALESCE(p_status, 'approved');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_any_role(v_uid, ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_worker_id IS NULL OR p_document_type_id IS NULL THEN
    RAISE EXCEPTION 'worker_id and document_type_id are required' USING ERRCODE = '22004';
  END IF;

  -- Canonical per-identity transactional lock: serialize concurrent writers
  -- for the same (worker_id, document_type_id). Released at COMMIT/ROLLBACK.
  v_lock_key := hashtextextended(
    'wd_rev:' || p_worker_id::text || ':' || p_document_type_id::text,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_type FROM public.document_types WHERE id = p_document_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type % not found', p_document_type_id USING ERRCODE = '23503';
  END IF;

  IF COALESCE(v_type.storage_scope, 'worker') <> 'worker' THEN
    RAISE EXCEPTION 'document_type % is not worker-scoped', v_type.code USING ERRCODE = '22023';
  END IF;

  IF v_type.category = 'sst_nr' THEN
    RAISE EXCEPTION 'sst_nr must be registered via register_sst_revision' USING ERRCODE = '22023';
  END IF;

  -- Lock the currently-vigente row (if any) to prevent concurrent supersede
  SELECT * INTO v_prev
    FROM public.worker_documents
   WHERE worker_id = p_worker_id
     AND document_type_id = p_document_type_id
     AND is_current = true
     AND deleted_at IS NULL
   FOR UPDATE;

  -- Idempotency: if the current revision matches this payload verbatim,
  -- return it without inserting a new row or emitting a duplicate event.
  IF FOUND
     AND v_prev.file_path IS NOT DISTINCT FROM p_file_path
     AND v_prev.file_name IS NOT DISTINCT FROM p_file_name
     AND v_prev.file_size IS NOT DISTINCT FROM p_file_size
     AND v_prev.mime_type IS NOT DISTINCT FROM p_mime_type
     AND v_prev.issue_date IS NOT DISTINCT FROM p_issue_date
     AND v_prev.expiry_date IS NOT DISTINCT FROM p_expiry_date
     AND v_prev.document_number IS NOT DISTINCT FROM p_document_number
     AND v_prev.issuing_authority IS NOT DISTINCT FROM p_issuing_authority
     AND v_prev.notes IS NOT DISTINCT FROM p_notes
     AND v_prev.status IS NOT DISTINCT FROM v_status
  THEN
    BEGIN
      INSERT INTO public.events (event_type, entity_type, entity_id, actor_id, metadata)
      VALUES (
        'worker_document.revision_idempotent_hit',
        'worker_document',
        v_prev.id,
        v_uid,
        jsonb_build_object(
          'worker_id', p_worker_id,
          'document_type_id', p_document_type_id,
          'document_type_code', v_type.code,
          'idempotent_hit', true
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN v_prev;
  END IF;

  -- Supersede previous current (if any)
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.worker_documents
       SET is_current = false, updated_at = now()
     WHERE id = v_prev.id;
  END IF;

  -- Insert new current
  INSERT INTO public.worker_documents (
    worker_id, document_type_id, document_type, category,
    file_path, file_name, file_size, mime_type,
    issue_date, expiry_date, document_number, issuing_authority,
    notes, status, is_current
  ) VALUES (
    p_worker_id, p_document_type_id, v_type.code, v_type.category,
    p_file_path, p_file_name, p_file_size, p_mime_type,
    p_issue_date, p_expiry_date, p_document_number, p_issuing_authority,
    p_notes, v_status, true
  )
  RETURNING * INTO v_new;

  BEGIN
    INSERT INTO public.events (event_type, entity_type, entity_id, actor_id, metadata)
    VALUES (
      'worker_document.revision_registered',
      'worker_document',
      v_new.id,
      v_uid,
      jsonb_build_object(
        'worker_id', p_worker_id,
        'document_type_id', p_document_type_id,
        'document_type_code', v_type.code,
        'previous_current_id', v_prev.id,
        'expiry_date', p_expiry_date,
        'issue_date', p_issue_date,
        'idempotent_hit', false
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.register_worker_document_revision(uuid, uuid, text, text, bigint, text, date, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_worker_document_revision(uuid, uuid, text, text, bigint, text, date, date, text, text, text, text) TO authenticated, service_role;