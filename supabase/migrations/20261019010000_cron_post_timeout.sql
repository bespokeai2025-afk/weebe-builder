-- The campaign executor runs ~20 jobs per request and takes ~85 s, longer than the 60 s pg_net
-- wait in cron_post(). The work still finished server-side, but net._http_response logged a
-- timeout instead of the result. Wait up to 5 minutes (matches the nginx proxy_read_timeout).
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
    timeout_milliseconds := 300000
  );
end;
$$;

revoke all on function public.cron_post(text) from public, anon, authenticated;
