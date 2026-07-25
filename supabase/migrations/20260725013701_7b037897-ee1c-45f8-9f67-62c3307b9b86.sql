
-- E-DOC.2.A — Corrective migration (v2: drop broad index first)

-- PART E-early: drop the old broad index before restoring is_current on legitimate duplicates
DROP INDEX IF EXISTS public.uq_worker_documents_current_by_type;

-- PART A: Repair prior damage on non-ASO rows
UPDATE public.worker_documents
   SET is_current = true, updated_at = now()
 WHERE deleted_at IS NULL
   AND is_current = false
   AND COALESCE(category,'') NOT IN ('sst_aso','aso');

-- PART B: Schema additions
ALTER TABLE public.worker_documents
  ADD COLUMN IF NOT EXISTS revision_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_type text,
  ADD COLUMN IF NOT EXISTS revision_reason text,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS expiry_source text,
  ADD COLUMN IF NOT EXISTS validity_rule_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS expiry_override_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name='worker_documents_supersedes_id_fkey'
       AND table_schema='public' AND table_name='worker_documents'
  ) THEN
    ALTER TABLE public.worker_documents
      ADD CONSTRAINT worker_documents_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES public.worker_documents(id) ON DELETE RESTRICT;
  END IF;
END $mig$;

-- PART D: ASO legacy backfill (no ambiguity — 0 workers with multiple ASOs)
UPDATE public.worker_documents
   SET revision_managed = true,
       is_current = true,
       revision_type = 'initial',
       expiry_source = 'legacy_unknown',
       validity_rule_snapshot = jsonb_build_object(
         'source','legacy_backfill',
         'captured_at', now(),
         'note','issue_date/expiry_date absent on legacy rows'
       ),
       updated_at = now()
 WHERE category = 'aso'
   AND deleted_at IS NULL
   AND document_type_id IS NOT NULL
   AND revision_managed = false;

-- PART C: CHECK constraints (after data is consistent)
ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_wd_supersedes_not_self
    CHECK (supersedes_id IS NULL OR supersedes_id <> id);
ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_wd_revmanaged_needs_type
    CHECK (NOT revision_managed OR document_type_id IS NOT NULL);
ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_wd_revtype_valid
    CHECK (NOT revision_managed OR revision_type IN ('initial','renewal','replacement','correction'));
ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_wd_current_not_superseded
    CHECK (NOT (is_current AND superseded_at IS NOT NULL));
ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_wd_superseded_not_current
    CHECK (superseded_at IS NULL OR NOT is_current);

-- PART E: Narrow indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_documents_current_revision_managed
  ON public.worker_documents (worker_id, document_type_id)
  WHERE revision_managed = true
    AND is_current = true
    AND deleted_at IS NULL
    AND document_type_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_documents_idempotency_key
  ON public.worker_documents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- PART F: Rewrite register_worker_document_revision (jsonb payload)
DROP FUNCTION IF EXISTS public.register_worker_document_revision(uuid,uuid,text,text,bigint,text,date,date,text,text,text,text);

CREATE OR REPLACE FUNCTION public.register_worker_document_revision(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $rpc$
DECLARE
  v_uid uuid := auth.uid();
  v_worker_id uuid;
  v_type_id uuid;
  v_operation text;
  v_expected_current uuid;
  v_idem uuid;
  v_file_path text; v_file_name text; v_file_size bigint; v_mime text;
  v_issued_at date; v_explicit_expiry date;
  v_doc_number text; v_authority text; v_notes text; v_reason text;
  v_lock_key bigint;
  v_type public.document_types%ROWTYPE;
  v_worker_exists boolean;
  v_prev public.worker_documents%ROWTYPE;
  v_new public.worker_documents%ROWTYPE;
  v_existing_idem public.worker_documents%ROWTYPE;
  v_computed_expiry date;
  v_snapshot jsonb;
  v_expiry_source text;
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

  IF v_worker_id IS NULL OR v_type_id IS NULL THEN
    RAISE EXCEPTION 'worker_id and document_type_id are required' USING ERRCODE = '22004';
  END IF;
  IF v_operation NOT IN ('initial','renewal','replacement','correction') THEN
    RAISE EXCEPTION 'invalid_operation: %', v_operation USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_worker_id AND w.deleted_at IS NULL)
    INTO v_worker_exists;
  IF NOT v_worker_exists THEN
    RAISE EXCEPTION 'worker_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_type FROM public.document_types WHERE id = v_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_type.category <> 'sst_aso' THEN
    RAISE EXCEPTION 'category_not_allowed: only sst_aso is enabled in this delivery' USING ERRCODE = '42501';
  END IF;
  IF v_type.storage_scope::text <> 'worker' THEN
    RAISE EXCEPTION 'storage_scope_mismatch: worker required' USING ERRCODE = '42501';
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

  v_lock_key := hashtextextended('wd_rev:'||v_worker_id::text||':'||v_type_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF v_idem IS NOT NULL THEN
    SELECT * INTO v_existing_idem FROM public.worker_documents WHERE idempotency_key = v_idem;
    IF FOUND THEN
      IF (v_existing_idem.worker_id = v_worker_id
          AND v_existing_idem.document_type_id = v_type_id
          AND COALESCE(v_existing_idem.file_path,'')       = COALESCE(v_file_path,'')
          AND COALESCE(v_existing_idem.file_name,'')       = COALESCE(v_file_name,'')
          AND COALESCE(v_existing_idem.file_size,0)        = COALESCE(v_file_size,0)
          AND COALESCE(v_existing_idem.mime_type,'')       = COALESCE(v_mime,'')
          AND v_existing_idem.issue_date IS NOT DISTINCT FROM v_issued_at
          AND COALESCE(v_existing_idem.document_number,'') = COALESCE(v_doc_number,'')
          AND COALESCE(v_existing_idem.issuing_authority,'') = COALESCE(v_authority,'')
          AND COALESCE(v_existing_idem.revision_type,'')   = v_operation
      ) THEN
        RETURN jsonb_build_object('idempotent_hit', true, 'document', to_jsonb(v_existing_idem));
      ELSE
        RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '23505';
      END IF;
    END IF;
  ELSE
    v_idem := gen_random_uuid();
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
    WHEN v_explicit_expiry IS NOT NULL THEN 'explicit'
    WHEN v_computed_expiry IS NOT NULL AND v_type.validity_mode::text = 'fixed_duration' THEN 'computed'
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
    'computed_at',         now()
  );

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.worker_documents
       SET is_current = false, superseded_at = now(), updated_at = now()
     WHERE id = v_prev.id;
  END IF;

  INSERT INTO public.worker_documents (
    worker_id, document_type_id, document_type, category, status,
    file_path, file_name, file_size, mime_type,
    issue_date, expiry_date, document_number, issuing_authority, notes,
    is_current, revision_managed, revision_type, revision_reason,
    supersedes_id, idempotency_key, expiry_source, validity_rule_snapshot,
    created_by
  ) VALUES (
    v_worker_id, v_type_id, v_type.code, v_type.category, 'uploaded',
    v_file_path, v_file_name, v_file_size, v_mime,
    v_issued_at, v_computed_expiry, v_doc_number, v_authority, v_notes,
    true, true, v_operation, v_reason,
    v_prev.id, v_idem, v_expiry_source, v_snapshot,
    v_uid
  ) RETURNING * INTO v_new;

  -- Atomic audit — no exception swallow
  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'worker_documents',
    v_new.id,
    'revision.'||v_operation,
    CASE WHEN v_prev.id IS NOT NULL THEN to_jsonb(v_prev) ELSE NULL END,
    to_jsonb(v_new),
    v_uid
  );

  RETURN jsonb_build_object('idempotent_hit', false, 'document', to_jsonb(v_new));
END;
$rpc$;

REVOKE ALL ON FUNCTION public.register_worker_document_revision(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_worker_document_revision(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_worker_document_revision(jsonb) TO authenticated;

-- PART G: Admin review status
CREATE OR REPLACE FUNCTION public.set_worker_document_review_status(
  p_document_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS public.worker_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $rev$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.worker_documents%ROWTYPE;
  v_new public.worker_documents%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved','rejected','pending','uploaded') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.worker_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.worker_documents
     SET status = p_status,
         notes = COALESCE(p_reason, notes),
         updated_at = now()
   WHERE id = p_document_id
   RETURNING * INTO v_new;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('worker_documents', p_document_id, 'review.'||p_status, to_jsonb(v_old), to_jsonb(v_new), v_uid);

  RETURN v_new;
END;
$rev$;

REVOKE ALL ON FUNCTION public.set_worker_document_review_status(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_worker_document_review_status(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_worker_document_review_status(uuid,text,text) TO authenticated;
