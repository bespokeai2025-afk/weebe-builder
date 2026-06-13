-- Campaign Executor — pg_cron wiring
--
-- Sets up a 5-minute cron job that POSTs to /api/public/campaign-executor
-- (secured with the service_role key stored in app_config).
--
-- One-time setup after applying this migration:
--   INSERT INTO public.app_config (key, value) VALUES
--     ('campaign_executor_url',  'https://<your-app-domain>/api/public/campaign-executor'),
--     ('campaign_executor_key',  '<SUPABASE_SERVICE_ROLE_KEY>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Extensions — pg_net and pg_cron are already enabled by the email_infra migration,
-- but we guard idempotently in case this migration runs first.
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

-- App-level config table (key/value, one row per setting)
CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.app_config TO service_role;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage app_config"
    ON public.app_config FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Helper function: reads URL + key from app_config and fires an HTTP POST.
-- Called by the pg_cron job below.
CREATE OR REPLACE FUNCTION public.trigger_campaign_executor()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'campaign_executor_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'campaign_executor_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[campaign-executor] campaign_executor_url or campaign_executor_key not set in app_config — skipping';
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

REVOKE EXECUTE ON FUNCTION public.trigger_campaign_executor() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_campaign_executor() TO service_role;

-- Schedule: run every 5 minutes.
-- cron.schedule is idempotent when the job name already exists in Supabase.
SELECT cron.schedule(
  'execute-call-campaigns',
  '*/5 * * * *',
  $$SELECT public.trigger_campaign_executor()$$
);
