-- Provider Health Sweep — pg_cron wiring
--
-- Schedules a 15-minute cron that POSTs to /api/public/provider-health-sweep
-- to refresh provider connection statuses across all workspaces.
--
-- One-time setup after applying this migration:
--   INSERT INTO public.app_config (key, value) VALUES
--     ('health_sweep_url', 'https://<your-app-domain>/api/public/provider-health-sweep'),
--     ('health_sweep_key', '<SUPABASE_SERVICE_ROLE_KEY>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trigger_provider_health_sweep()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'health_sweep_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'health_sweep_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[provider-health-sweep] health_sweep_url or health_sweep_key not set in app_config — skipping';
    RETURN;
  END IF;

  PERFORM extensions.net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_provider_health_sweep() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_provider_health_sweep() TO service_role;

SELECT cron.schedule(
  'provider-health-sweep',
  '*/15 * * * *',
  $$SELECT public.trigger_provider_health_sweep()$$
);
