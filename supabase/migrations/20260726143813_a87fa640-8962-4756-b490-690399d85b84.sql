-- 1) Divergent function removed. The UI reads the table directly (RLS-protected);
--    remaining server-side listing goes through peek_due_storage_cleanup_jobs.
DROP FUNCTION IF EXISTS public.list_pending_storage_cleanup_jobs(integer);
DROP FUNCTION IF EXISTS public.list_pending_storage_cleanup_jobs(int);

-- 2) pg_net for cron HTTP calls.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 3) Admin-only seeder for the Vault secret used by the cron job.
--    Never returns or logs the plaintext.
CREATE OR REPLACE FUNCTION public.set_cleanup_cron_secret(p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;
  IF p_value IS NULL OR length(p_value) < 16 THEN
    RAISE EXCEPTION 'invalid_secret' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name='cleanup_cron_secret') THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name='cleanup_cron_secret'),
      p_value, 'cleanup_cron_secret',
      'Shared secret for storage-cleanup cron -> edge function');
  ELSE
    PERFORM vault.create_secret(
      p_value, 'cleanup_cron_secret',
      'Shared secret for storage-cleanup cron -> edge function');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_cleanup_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cleanup_cron_secret(text) TO authenticated;

-- 4) Scheduled retry. Runs every 5 minutes. Reads the shared secret from Vault
--    at call time so plaintext never touches the schedule definition or logs.
--    If Vault is empty, an empty header is sent and the edge function rejects it (fail-closed).
DO $$
BEGIN
  -- Idempotent (re)install.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-cleanup-retry') THEN
    PERFORM cron.unschedule('storage-cleanup-retry');
  END IF;

  PERFORM cron.schedule(
    'storage-cleanup-retry',
    '*/5 * * * *',
    $CRON$
    SELECT extensions.http_post(
      url     := 'https://haqoulzaandgcwnbrytz.supabase.co/functions/v1/storage-cleanup-process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret',
        coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cleanup_cron_secret'), '')
      ),
      body    := jsonb_build_object('limit', 50, 'dryRun', false)
    );
    $CRON$
  );
END $$;