
-- RPC canônica dedicada ao bank_document: promoção idempotente ou registro atômico com supersede.
-- Nota: o índice único global (worker_id, document_type_id) WHERE is_current cannot be enforced now
-- porque há duplicidades legadas em outros tipos. A unicidade para bank_document é garantida por
-- advisory lock + supersede dentro desta função.
CREATE OR REPLACE FUNCTION public.register_bank_document_revision(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_worker_id uuid;
  v_type_id uuid;
  v_promote_id uuid;
  v_file_path text;
  v_file_name text;
  v_file_size bigint;
  v_mime text;
  v_notes text;
  v_type public.document_types%ROWTYPE;
  v_worker_exists boolean;
  v_prev public.worker_documents%ROWTYPE;
  v_target public.worker_documents%ROWTYPE;
  v_new public.worker_documents%ROWTYPE;
  v_lock_key bigint;
  v_trace_id uuid := gen_random_uuid();
  v_mode text;
  v_result jsonb;
BEGIN
  -- Guard: auth + role
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_worker_id  := NULLIF(p_payload->>'worker_id','')::uuid;
  v_type_id    := NULLIF(p_payload->>'document_type_id','')::uuid;
  v_promote_id := NULLIF(p_payload->>'promote_existing_id','')::uuid;
  v_file_path  := NULLIF(p_payload->>'file_path','');
  v_file_name  := NULLIF(p_payload->>'file_name','');
  v_file_size  := NULLIF(p_payload->>'file_size','')::bigint;
  v_mime       := NULLIF(p_payload->>'mime_type','');
  v_notes      := NULLIF(p_payload->>'notes','');

  IF v_worker_id IS NULL OR v_type_id IS NULL THEN
    RAISE EXCEPTION 'worker_id_and_document_type_id_required' USING ERRCODE = '22004';
  END IF;

  -- Type check: só bank_document (code canônico) — impede desvio para outras categorias.
  SELECT * INTO v_type FROM public.document_types WHERE id = v_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_type.code <> 'bank_document' THEN
    RAISE EXCEPTION 'document_type_not_bank_document' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_worker_id AND w.deleted_at IS NULL)
    INTO v_worker_exists;
  IF NOT v_worker_exists THEN
    RAISE EXCEPTION 'worker_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Advisory lock por (worker, type)
  v_lock_key := hashtextextended('bank_doc_rev:'||v_worker_id::text||':'||v_type_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF v_promote_id IS NOT NULL THEN
    v_mode := 'promote';

    SELECT * INTO v_target
      FROM public.worker_documents
     WHERE id = v_promote_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker_document_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.worker_id <> v_worker_id OR v_target.document_type_id <> v_type_id THEN
      RAISE EXCEPTION 'worker_document_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_target.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'worker_document_deleted' USING ERRCODE = '22023';
    END IF;

    -- Idempotência: já está current, não faz nada.
    IF v_target.is_current = true THEN
      RETURN jsonb_build_object(
        'mode', v_mode,
        'idempotent_hit', true,
        'document', to_jsonb(v_target),
        'trace_id', v_trace_id
      );
    END IF;

    -- Marca qualquer outro current do mesmo (worker, type) como false ANTES de promover.
    UPDATE public.worker_documents
       SET is_current = false, superseded_at = now(), updated_at = now()
     WHERE worker_id = v_worker_id
       AND document_type_id = v_type_id
       AND deleted_at IS NULL
       AND is_current = true
       AND id <> v_target.id;

    -- Promove o alvo.
    UPDATE public.worker_documents
       SET is_current = true,
           superseded_at = NULL,
           updated_at = now()
     WHERE id = v_target.id
    RETURNING * INTO v_new;

    INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    VALUES ('worker_documents', v_new.id, 'bank_document.promote_current',
            to_jsonb(v_target), to_jsonb(v_new) || jsonb_build_object('trace_id', v_trace_id),
            v_uid);

    RETURN jsonb_build_object(
      'mode', v_mode,
      'idempotent_hit', false,
      'document', to_jsonb(v_new),
      'trace_id', v_trace_id
    );
  END IF;

  -- Modo insert: exige arquivo.
  v_mode := 'insert';
  IF v_file_path IS NULL OR v_file_name IS NULL THEN
    RAISE EXCEPTION 'file_path_and_file_name_required' USING ERRCODE = '22004';
  END IF;

  -- Supersede qualquer current anterior deste worker/type.
  SELECT * INTO v_prev
    FROM public.worker_documents
   WHERE worker_id = v_worker_id
     AND document_type_id = v_type_id
     AND is_current = true
     AND deleted_at IS NULL
     FOR UPDATE;
  IF FOUND THEN
    UPDATE public.worker_documents
       SET is_current = false, superseded_at = now(), updated_at = now()
     WHERE id = v_prev.id;
  END IF;

  INSERT INTO public.worker_documents (
    worker_id, document_type_id, document_type, category, status,
    file_path, file_name, file_size, mime_type,
    is_current, notes, created_by, supersedes_id
  ) VALUES (
    v_worker_id, v_type_id, v_type.code, v_type.category, 'uploaded',
    v_file_path, v_file_name, v_file_size, v_mime,
    true, COALESCE(v_notes,'auto_generated'), v_uid, v_prev.id
  ) RETURNING * INTO v_new;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('worker_documents', v_new.id, 'bank_document.insert_current',
          CASE WHEN v_prev.id IS NOT NULL THEN to_jsonb(v_prev) ELSE NULL END,
          to_jsonb(v_new) || jsonb_build_object('trace_id', v_trace_id),
          v_uid);

  RETURN jsonb_build_object(
    'mode', v_mode,
    'idempotent_hit', false,
    'document', to_jsonb(v_new),
    'trace_id', v_trace_id,
    'superseded_id', v_prev.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_bank_document_revision(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_bank_document_revision(jsonb) TO authenticated, service_role;
