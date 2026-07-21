
DROP POLICY IF EXISTS "Users can claim viewer role" ON public.user_roles;

REVOKE EXECUTE ON FUNCTION public.audit_catalog_change() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reevaluate_worker_links(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_compliance_expiration_job(integer, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_link_compliance(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.document_compliance_summary(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_link_compliance_timeline(uuid, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_link_document_override(uuid, uuid, text, date, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reevaluate_job_role_links(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_compliance_transitions(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_job_role_requirements(uuid, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.simulate_link_compliance(uuid, jsonb) FROM anon, PUBLIC;
