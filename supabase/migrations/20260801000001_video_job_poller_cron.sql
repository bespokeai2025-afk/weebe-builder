-- Video Job Poller — pg_cron wiring
--
-- Schedules a 1-minute cron that POSTs to /api/public/video-job-poller
-- to poll Veo 3 / Runway job statuses and mark completed videos.
-- Without this, generated video jobs stay "pending" forever in production.
--
-- One-time setup after applying this migration:
--   INSERT INTO public.app_config (key, value) VALUES
--     ('video_poller_url', 'https://<your-app-domain>/api/public/video-job-poller'),
--     ('video_poller_key', '<SUPABASE_SERVICE_ROLE_KEY>')
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

CREATE OR REPLACE FUNCTION public.trigger_video_job_poller()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'video_poller_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'video_poller_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[video-job-poller] video_poller_url or video_poller_key not set in app_config — skipping';
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

REVOKE EXECUTE ON FUNCTION public.trigger_video_job_poller() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_video_job_poller() TO service_role;

SELECT cron.schedule(
  'video-job-poller',
  '* * * * *',
  $$SELECT public.trigger_video_job_poller()$$
);
