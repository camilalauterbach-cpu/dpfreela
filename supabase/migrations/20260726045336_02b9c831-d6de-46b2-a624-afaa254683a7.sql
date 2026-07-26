-- 1) Enforce that ASO document types always have an expiration configured.
CREATE OR REPLACE FUNCTION public.enforce_aso_has_expiration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category = 'sst_aso' THEN
    IF NEW.has_expiration IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'aso_requires_expiration' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.validity_mode IS NOT NULL AND NEW.validity_mode = 'no_expiry' THEN
      RAISE EXCEPTION 'aso_requires_expiration' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_aso_has_expiration ON public.document_types;
CREATE TRIGGER trg_enforce_aso_has_expiration
  BEFORE INSERT OR UPDATE ON public.document_types
  FOR EACH ROW EXECUTE FUNCTION public.enforce_aso_has_expiration();

-- Normalize any drifted ASO row (defensive; should be no-op).
UPDATE public.document_types
   SET has_expiration = TRUE
 WHERE category = 'sst_aso' AND has_expiration IS DISTINCT FROM TRUE;

-- 2) RPC: correct ONLY the emission/expiry of the current ASO of a worker.
--    Does NOT touch id, file_path, storage, or create a new row.
CREATE OR REPLACE FUNCTION public.correct_worker_document_validity(
  p_document_id uuid,
  p_expected_current_id uuid,
  p_issue_date date,
  p_expiry_date date,
  p_reason text DEFAULT NULL,
  p_trace_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.worker_documents%ROWTYPE;
  v_type public.document_types%ROWTYPE;
  v_trace text := COALESCE(NULLIF(p_trace_id,''), 'cwdv-' || substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_old jsonb;
  v_new jsonb;
  v_snapshot jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    public.has_role(v_uid,'admin') OR public.has_role(v_uid,'manager') OR public.has_role(v_uid,'operator')
  ) THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = '42501';
  END IF;

  IF p_document_id IS NULL OR p_issue_date IS NULL OR p_expiry_date IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE = '22004';
  END IF;

  IF p_expiry_date <= p_issue_date THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE = '22007';
  END IF;

  -- Serialize concurrent edits on the same worker/document type.
  PERFORM pg_advisory_xact_lock(hashtextextended('cwdv:' || p_document_id::text, 0));

  SELECT * INTO v_doc FROM public.worker_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'document_deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.is_current IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'document_not_current' USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_current_id IS NOT NULL AND p_expected_current_id <> v_doc.id THEN
    RAISE EXCEPTION 'stale_current_document' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_type FROM public.document_types WHERE id = v_doc.document_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_document_type' USING ERRCODE = 'P0002';
  END IF;
  IF v_type.category <> 'sst_aso' THEN
    RAISE EXCEPTION 'not_aso_document' USING ERRCODE = 'P0001';
  END IF;
  IF v_type.storage_scope IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'invalid_storage_scope' USING ERRCODE = 'P0001';
  END IF;

  v_old := jsonb_build_object(
    'id', v_doc.id,
    'issue_date', v_doc.issue_date,
    'expiry_date', v_doc.expiry_date,
    'expiry_source', v_doc.expiry_source,
    'validity_rule_snapshot', v_doc.validity_rule_snapshot,
    'updated_at', v_doc.updated_at
  );

  v_snapshot := jsonb_build_object(
    'mode', 'explicit_correction',
    'issued_at', p_issue_date,
    'expires_at', p_expiry_date,
    'document_type_id', v_type.id,
    'default_validity_days', v_type.default_validity_days,
    'reason', p_reason,
    'trace_id', v_trace,
    'corrected_by', v_uid,
    'corrected_at', now()
  );

  UPDATE public.worker_documents
     SET issue_date = p_issue_date,
         expiry_date = p_expiry_date,
         expiry_source = 'explicit',
         expiry_override_reason = COALESCE(p_reason, expiry_override_reason),
         validity_rule_snapshot = v_snapshot,
         updated_at = now()
   WHERE id = v_doc.id;

  v_new := jsonb_build_object(
    'id', v_doc.id,
    'issue_date', p_issue_date,
    'expiry_date', p_expiry_date,
    'expiry_source', 'explicit',
    'validity_rule_snapshot', v_snapshot,
    'trace_id', v_trace
  );

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('worker_documents', v_doc.id, 'aso_validity_correction',
          v_old, v_new || jsonb_build_object('trace_id', v_trace), v_uid);

  -- Best-effort revision event; do not fail correction if optional.
  BEGIN
    PERFORM public.log_worker_document_revision_event(
      v_doc.id, 'validity_corrected',
      jsonb_build_object(
        'trace_id', v_trace,
        'issue_date', p_issue_date,
        'expiry_date', p_expiry_date,
        'reason', p_reason
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Reavaliar vínculos após alterar a validade do ASO vigente.
  PERFORM public.reevaluate_worker_links(v_doc.worker_id, 'aso_validity_correction');

  RETURN jsonb_build_object(
    'ok', true,
    'trace_id', v_trace,
    'document_id', v_doc.id,
    'worker_id', v_doc.worker_id,
    'issue_date', p_issue_date,
    'expiry_date', p_expiry_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_worker_document_validity(uuid, uuid, date, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_worker_document_validity(uuid, uuid, date, date, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.correct_worker_document_validity(uuid, uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_worker_document_validity(uuid, uuid, date, date, text, text) TO service_role;