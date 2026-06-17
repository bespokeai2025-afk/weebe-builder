-- Ads Sync — pg_cron wiring
--
-- Adds a 15-minute cron job that POSTs to /api/public/ads-sync to keep ad
-- campaign metrics fresh for all workspaces with advertising credentials.
--
-- The endpoint is also called implicitly every 5 minutes via the existing
-- campaign-executor cron (execute-call-campaigns), so this dedicated job
-- provides a more frequent/independent schedule for analytics pages.
--
-- One-time setup after applying this migration (if not already done for
-- campaign-executor):
--   INSERT INTO public.app_config (key, value) VALUES
--     ('ads_sync_url',    'https://<your-app-domain>/api/public/ads-sync'),
--     ('ads_sync_secret', '<your CRON_SECRET value>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--
-- The CRON_SECRET value must match the CRON_SECRET environment variable set
-- on the production server.

-- Ensure pg_net and pg_cron extensions are available (guarded idempotently).
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

-- Ensure app_config table exists (created by campaign_executor_cron migration,
-- but guard here in case this runs in isolation).
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

-- Helper function: reads URL + secret from app_config and fires an HTTP POST
-- to /api/public/ads-sync with the x-cron-secret header.
CREATE OR REPLACE FUNCTION public.trigger_ads_sync()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.app_config WHERE key = 'ads_sync_url';
  SELECT value INTO v_secret FROM public.app_config WHERE key = 'ads_sync_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE '[ads-sync] ads_sync_url or ads_sync_secret not set in app_config — skipping';
    RETURN;
  END IF;

  PERFORM extensions.net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  v_secret
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_ads_sync() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_ads_sync() TO service_role;

-- Schedule: run every 15 minutes.
-- cron.schedule is idempotent when the job name already exists in Supabase.
SELECT cron.schedule(
  'sync-ads-analytics',
  '*/15 * * * *',
  $$SELECT public.trigger_ads_sync()$$
);
