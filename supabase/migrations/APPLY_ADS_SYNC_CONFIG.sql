-- ═══════════════════════════════════════════════════════════════════════════════
-- ADS SYNC CONFIG — app_config rows
-- Run this AFTER applying 20260722000000_ads_sync_cron.sql (or the combined
-- migrations file) in the Supabase SQL Editor.
--
-- Replace <CRON_SECRET> with the value of your CRON_SECRET environment variable
-- (set in Replit Secrets). This must match exactly what the server reads from
-- process.env.CRON_SECRET at runtime.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.app_config (key, value) VALUES
  ('ads_sync_url',    'https://webeebuilder.com/api/public/ads-sync'),
  ('ads_sync_secret', '<CRON_SECRET>')
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = now();

-- Verify the rows landed correctly:
SELECT key, left(value, 40) AS value_preview, updated_at
FROM public.app_config
WHERE key IN ('ads_sync_url', 'ads_sync_secret');

-- Verify the cron job is registered:
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'sync-ads-analytics';
