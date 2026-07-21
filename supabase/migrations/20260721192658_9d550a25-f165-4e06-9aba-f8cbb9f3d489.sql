
-- Allow managers to view the scope gate (mutations still admin-only)
DROP POLICY IF EXISTS "Admins can view scope gate" ON public.document_type_scope_backfill_unmatched;
CREATE POLICY "Admins and managers can view scope gate"
  ON public.document_type_scope_backfill_unmatched
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role]));

-- Enforce near-immutability of storage_scope in resolve RPC
CREATE OR REPLACE FUNCTION public.resolve_document_type_scope(
  p_document_type_id uuid,
  p_scope document_storage_scope,
  p_notes text DEFAULT NULL::text,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_current document_storage_scope;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden: apenas administradores podem resolver o gate de escopo';
  END IF;

  SELECT storage_scope INTO v_current
    FROM public.document_types
   WHERE id = p_document_type_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type % não encontrado', p_document_type_id;
  END IF;

  IF v_current IS NOT NULL AND v_current <> p_scope AND NOT p_force THEN
    RAISE EXCEPTION 'storage_scope já definido como %; use p_force=true para alterar', v_current
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.document_types
     SET storage_scope = p_scope,
         updated_at = now()
   WHERE id = p_document_type_id;

  UPDATE public.document_type_scope_backfill_unmatched
     SET resolved_scope = p_scope,
         resolved_by = v_uid,
         resolved_at = now(),
         notes = COALESCE(p_notes, notes),
         updated_at = now()
   WHERE document_type_id = p_document_type_id;

  RETURN jsonb_build_object(
    'document_type_id', p_document_type_id,
    'storage_scope', p_scope,
    'previous_scope', v_current,
    'forced', (v_current IS NOT NULL AND v_current <> p_scope AND p_force),
    'resolved_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_document_type_scope(uuid, document_storage_scope, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_document_type_scope(uuid, document_storage_scope, text, boolean) TO authenticated;

-- Drop old 3-arg signature to avoid ambiguity
DROP FUNCTION IF EXISTS public.resolve_document_type_scope(uuid, document_storage_scope, text);
