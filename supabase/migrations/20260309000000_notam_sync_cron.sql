-- Schedule the notam-sync Edge Function to run every 15 minutes via pg_cron + pg_net.
--
-- PREREQUISITES before running this migration:
--   1. Register at https://api.faa.gov/ for free API credentials.
--   2. In Supabase Dashboard → Settings → Edge Functions, add secrets:
--        FAA_NOTAM_CLIENT_ID     (from FAA registration)
--        FAA_NOTAM_CLIENT_SECRET (from FAA registration)
--        NOTAM_SYNC_TOKEN        (any random string, e.g. openssl rand -hex 32)
--   3. In Supabase Dashboard → Settings → Database, run:
--        ALTER DATABASE postgres SET "app.notam_sync_token" TO '<your-NOTAM_SYNC_TOKEN>';
--      This lets pg_cron read the token at runtime.
--   4. Deploy the function:
--        supabase functions deploy notam-sync
--   5. Then apply this migration:
--        supabase db push

-- Ensure pg_net is available (Supabase enables it by default; this is a no-op if so)
create extension if not exists pg_net schema extensions;

-- Remove any previous schedule with the same name (idempotent)
select cron.unschedule('notam-sync-15min') where exists (
  select 1 from cron.job where jobname = 'notam-sync-15min'
);

-- Schedule notam-sync every 15 minutes
select cron.schedule(
  'notam-sync-15min',
  '*/15 * * * *',
  $$
  select extensions.http_post(
    url     := 'https://cakmsciuqaodlgzbrcfu.supabase.co/functions/v1/notam-sync',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(
        current_setting('app.notam_sync_token', true),
        ''
      )
    )
  )
  $$
);
