-- Point the production background jobs at the production app (webeesmartdash.com).
--
-- Until now every cron target was a placeholder ("https://YOUR-APP.replit.app", key
-- "YOUR-SUPABASE-SERVICE-ROLE-KEY"), so pg_cron never ran the campaign executor, video poller or
-- provider health sweep — they only ran while someone had a dev server open. Dev servers no longer
-- start those jobs (vite.config.ts), so this is now the only scheduler.
--
-- The bearer key lives in Supabase Vault, not in app_config. Create it once (SQL editor):
--   select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'cron_service_role_key');
-- Until it exists every job logs a NOTICE and does nothing.

insert into public.app_config (key, value) values
  ('campaign_executor_url',      'https://webeesmartdash.com/api/public/campaign-executor'),
  ('video_job_poller_url',       'https://webeesmartdash.com/api/public/video-job-poller'),
  ('health_sweep_url',           'https://webeesmartdash.com/api/public/provider-health-sweep'),
  ('stale_call_sweep_url',       'https://webeesmartdash.com/api/public/stale-call-sweep')
on conflict (key) do update set value = excluded.value;

-- Placeholder secrets that were never real values.
delete from public.app_config where key in ('campaign_executor_key', 'ads_sync_secret', 'ads_sync_url', 'health_sweep_key');

create or replace function public.cron_post(url_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from public.app_config where key = url_key;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_service_role_key';
  if v_url is null or v_key is null then
    raise notice '[cron] % or vault secret cron_service_role_key missing — skipping', url_key;
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.cron_post(text) from public, anon, authenticated;

create or replace function public.trigger_campaign_executor()
returns void language sql security definer set search_path = public
as $$ select public.cron_post('campaign_executor_url') $$;

create or replace function public.trigger_provider_health_sweep()
returns void language sql security definer set search_path = public
as $$ select public.cron_post('health_sweep_url') $$;

revoke all on function public.trigger_campaign_executor() from public, anon, authenticated;
revoke all on function public.trigger_provider_health_sweep() from public, anon, authenticated;

-- Video poller: was an inline net.http_post to the placeholder host.
select cron.unschedule(jobid) from cron.job where jobname = 'video-job-poller';
select cron.schedule('video-job-poller', '* * * * *', $$select public.cron_post('video_job_poller_url')$$);

-- Stale native-call sweep: had no production schedule at all.
select cron.unschedule(jobid) from cron.job where jobname = 'stale-call-sweep';
select cron.schedule('stale-call-sweep', '*/10 * * * *', $$select public.cron_post('stale_call_sweep_url')$$);

-- Ads sync already runs inside every campaign-executor tick (runAdsSyncTick); the separate job
-- pointed at an old host with a placeholder secret.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-ads-analytics';
