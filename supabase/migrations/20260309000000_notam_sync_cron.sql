-- Schedule the notam-sync Edge Function to run every 15 minutes via pg_cron + pg_net.
--
-- Applied manually to the live project on 2026-09-20 (job 'notam-sync-15min').
--
-- PREREQUISITES before running this migration:
--   1. Obtain NMS-API OAuth2 client credentials (FAA NOTAM Management System,
--      CGI Federal host api-staging.cgifederal-aim.com). Contact NOTAMS@faa.gov.
--   2. In Supabase Dashboard → Edge Functions → Secrets, add:
--        NMS_API_CLIENT_ID
--        NMS_API_CLIENT_SECRET
--        NOTAM_SYNC_TOKEN (optional; if set, the function also requires it as
--                          x-sync-token / bearer and this command must send it)
--   3. Store the project's anon key in Vault so pg_cron can send it as the
--      bearer token the Functions gateway expects:
--        select vault.create_secret('<anon key>', 'supabase_anon_key');
--   4. Deploy the function:
--        supabase functions deploy notam-sync
--   5. Then apply this migration:
--        supabase db push

-- Ensure required extensions are available.
-- pg_net always installs its functions into the `net` schema.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Remove any previous schedule with the same name (idempotent)
select cron.unschedule('notam-sync-15min') where exists (
  select 1 from cron.job where jobname = 'notam-sync-15min'
);

-- Schedule notam-sync every 15 minutes
select cron.schedule(
  'notam-sync-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://cakmsciuqaodlgzbrcfu.supabase.co/functions/v1/notam-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'supabase_anon_key'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
