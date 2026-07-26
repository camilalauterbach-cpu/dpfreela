REVOKE ALL ON FUNCTION public.get_cleanup_cron_activation_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cleanup_cron_activation_status() TO service_role;