
-- Revoke EXECUTE from anon/public on SECURITY DEFINER functions, then re-grant only where needed.

-- Invite lifecycle functions: called exclusively by edge function via service_role.
REVOKE EXECUTE ON FUNCTION public.claim_public_invite(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_public_invite(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_public_invite(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Authenticated-only privileged operations (self-check auth.uid() and roles).
REVOKE EXECUTE ON FUNCTION public.ensure_worker(jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_worker(jsonb, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.list_worker_duplicate_candidates() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_worker_duplicate_candidates() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.merge_workers(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.merge_workers(uuid, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.merge_workers_preview(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.merge_workers_preview(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.register_sst_revision(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.register_sst_revision(jsonb) TO authenticated;
