
-- 1) is_current column
ALTER TABLE public.worker_documents
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

-- 2) Backfill: latest non-deleted row per (worker_id, document_type_id) → is_current = true
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY worker_id, document_type_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.worker_documents
  WHERE deleted_at IS NULL
    AND document_type_id IS NOT NULL
)
UPDATE public.worker_documents wd
SET is_current = true
FROM ranked r
WHERE wd.id = r.id AND r.rn = 1;

-- Rows without document_type_id (legacy): mark themselves as current to preserve behavior
UPDATE public.worker_documents
SET is_current = true
WHERE deleted_at IS NULL AND document_type_id IS NULL AND is_current = false;

-- 3) Partial unique index on the current revision per (worker, document_type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_documents_current_by_type
  ON public.worker_documents (worker_id, document_type_id)
  WHERE is_current AND deleted_at IS NULL AND document_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_documents_current
  ON public.worker_documents (worker_id, document_type_id)
  WHERE is_current AND deleted_at IS NULL;

-- 4) RPC: register_worker_document_revision
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
  v_prev_id uuid;
  v_new public.worker_documents%ROWTYPE;
  v_uid uuid := auth.uid();
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

  -- Invalidate previous current
  UPDATE public.worker_documents
     SET is_current = false, updated_at = now()
   WHERE worker_id = p_worker_id
     AND document_type_id = p_document_type_id
     AND is_current = true
     AND deleted_at IS NULL
  RETURNING id INTO v_prev_id;

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
    p_notes, COALESCE(p_status, 'approved'), true
  )
  RETURNING * INTO v_new;

  -- Audit event (best-effort)
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
        'previous_current_id', v_prev_id,
        'expiry_date', p_expiry_date,
        'issue_date', p_issue_date
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
