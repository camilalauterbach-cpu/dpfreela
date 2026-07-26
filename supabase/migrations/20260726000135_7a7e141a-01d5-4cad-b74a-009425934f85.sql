
-- Revoke EXECUTE from anon and PUBLIC for our SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.assert_worker_registration_complete() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_sst_revision(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_worker_registration_completion(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_all_workers_registration_status() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_document_type_completion_requirement(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_doc_types_reeval_completion() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_worker_docs_reeval_completion() FROM anon, PUBLIC;

-- Ensure authenticated + service_role can still call the callable RPCs (trigger funcs stay locked)
GRANT EXECUTE ON FUNCTION public.delete_sst_revision(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_worker_registration_completion(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_document_type_completion_requirement(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_worker_registration_complete() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_workers_registration_status() TO service_role;

-- Fix mutable search_path on our own helper function
ALTER FUNCTION public.document_is_valid_for_completion(text, date, timestamptz, boolean, boolean, public.document_validity_mode) SET search_path = public, pg_temp;
