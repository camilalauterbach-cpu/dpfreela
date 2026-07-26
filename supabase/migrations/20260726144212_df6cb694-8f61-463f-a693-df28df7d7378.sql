
-- Allow service_role to invoke set_cleanup_cron_secret (Edge Function activation path).
-- Admin remains authorized. Anon and common users remain blocked.
CREATE OR REPLACE FUNCTION public.set_cleanup_cron_secret(p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF v_role = 'service_role' THEN
    -- allowed
    NULL;
  ELSIF v_uid IS NOT NULL AND public.has_role(v_uid,'admin'::public.app_role) THEN
    -- allowed
    NULL;
  ELSE
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
$function$;

REVOKE ALL ON FUNCTION public.set_cleanup_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cleanup_cron_secret(text) TO service_role;

-- Read-only helper: reports whether the vault secret exists and whether the cron job
-- is active. Never reads or returns the plaintext value.
CREATE OR REPLACE FUNCTION public.get_cleanup_cron_activation_status()
RETURNS TABLE(vault_present boolean, cron_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF auth.role() <> 'service_role'
     AND (v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['admin','manager','operator']::public.app_role[])) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (SELECT 1 FROM vault.secrets WHERE name='cleanup_cron_secret') AS vault_present,
    EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname='storage-cleanup-retry' AND active
    ) AS cron_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cleanup_cron_activation_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cleanup_cron_activation_status() TO authenticated, service_role;
