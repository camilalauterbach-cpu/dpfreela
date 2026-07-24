REVOKE EXECUTE ON FUNCTION public.list_worker_qualifications(uuid[], text, text, boolean, integer, integer, boolean, uuid, uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_effective_document_requirements(uuid[], uuid, uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_worker_operational_contexts(uuid[], uuid, uuid, boolean) FROM anon, PUBLIC;