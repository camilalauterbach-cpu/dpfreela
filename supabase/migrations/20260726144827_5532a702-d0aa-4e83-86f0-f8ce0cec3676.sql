DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-cleanup-retry') THEN
    PERFORM cron.unschedule('storage-cleanup-retry');
  END IF;

  PERFORM cron.schedule(
    'storage-cleanup-retry',
    '*/5 * * * *',
    $CRON$
    SELECT net.http_post(
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