-- Stale Call Sweep — pg_cron wiring
--
-- Schedules a 10-minute cron that POSTs to /api/public/stale-call-sweep to
-- close out native-engine calls stuck in `in_progress` because their
-- call_ended webhook was never delivered. See
-- src/lib/voice/lifecycle/stale-call-sweep.server.ts for why that happens.
--
-- One-time setup after applying this migration:
--   INSERT INTO public.app_config (key, value) VALUES
--     ('stale_call_sweep_url', 'https://<your-app-domain>/api/public/stale-call-sweep'),
--     ('stale_call_sweep_key', '<SUPABASE_SERVICE_ROLE_KEY>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

-- Reuses the same app_config table provider-health-sweep's migration creates.
CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trigger_stale_call_sweep()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'stale_call_sweep_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'stale_call_sweep_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[stale-call-sweep] stale_call_sweep_url or stale_call_sweep_key not set in app_config — skipping';
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

REVOKE EXECUTE ON FUNCTION public.trigger_stale_call_sweep() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_stale_call_sweep() TO service_role;

SELECT cron.schedule(
  'stale-call-sweep',
  '*/10 * * * *',
  $$SELECT public.trigger_stale_call_sweep()$$
);
