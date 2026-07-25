
CREATE OR REPLACE FUNCTION public.evaluate_worker_registration_completion(p_worker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_missing jsonb;
  v_status text;
BEGIN
  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  WITH required_types AS (
    SELECT id, code, name, has_expiration, validity_mode
      FROM public.document_types
     WHERE is_active = true
       AND completion_requirement = 'required'
  ),
  best_doc AS (
    SELECT DISTINCT ON (wd.document_type_id)
           wd.id AS worker_document_id,
           wd.document_type_id, wd.status, wd.expiry_date, wd.deleted_at, wd.is_current,
           wd.file_name, wd.file_path, wd.updated_at, wd.created_at
      FROM public.worker_documents wd
     WHERE wd.worker_id = p_worker_id
       AND wd.deleted_at IS NULL
       AND wd.document_type_id IS NOT NULL
     ORDER BY wd.document_type_id,
              (wd.is_current IS TRUE) DESC,
              coalesce(wd.expiry_date, '1900-01-01'::date) DESC,
              wd.created_at DESC
  ),
  eval AS (
    SELECT rt.id, rt.code, rt.name,
           bd.worker_document_id, bd.status, bd.expiry_date,
           bd.file_name, bd.file_path, bd.updated_at,
           (bd.document_type_id IS NOT NULL)
             AND public.document_is_valid_for_completion(
               bd.status, bd.expiry_date, bd.deleted_at, bd.is_current,
               rt.has_expiration, rt.validity_mode
             ) AS ok,
           CASE
             WHEN bd.document_type_id IS NULL THEN 'ausente'
             WHEN coalesce(bd.status,'') = 'rejected' THEN 'rejeitado'
             WHEN (rt.has_expiration OR rt.validity_mode IN ('fixed_duration','explicit_date'))
                  AND (bd.expiry_date IS NULL OR bd.expiry_date < current_date) THEN 'vencido'
             ELSE 'ausente'
           END AS reason
      FROM required_types rt
      LEFT JOIN best_doc bd ON bd.document_type_id = rt.id
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'document_type_id', id,
             'code', code,
             'name', name,
             'reason', reason,
             'status', status,
             'expiry_date', expiry_date,
             'rejected_at', CASE WHEN reason = 'rejeitado' THEN updated_at ELSE NULL END,
             'last_update_at', updated_at,
             'worker_document_id', worker_document_id,
             'file_name', file_name,
             'file_path', file_path
           ) ORDER BY name
         ) FILTER (WHERE ok IS DISTINCT FROM true), '[]'::jsonb)
    INTO v_missing
    FROM eval;

  v_status := CASE WHEN jsonb_array_length(v_missing) = 0 THEN 'complete' ELSE 'incomplete' END;

  UPDATE public.workers
     SET registration_status = v_status,
         updated_at = now()
   WHERE id = p_worker_id
     AND registration_status IS DISTINCT FROM v_status;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'status', v_status,
    'missing', v_missing,
    'evaluated_at', now()
  );
END;
$function$;
