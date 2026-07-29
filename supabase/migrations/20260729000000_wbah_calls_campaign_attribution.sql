-- WBAH Reports accuracy: verified campaign attribution columns on wbah_calls.
-- Additive + idempotent. campaign_id/campaign_run_id/lead_id/provider_call_id
-- are text because WeeBespoke ids are not UUIDs.
ALTER TABLE public.wbah_calls ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE public.wbah_calls ADD COLUMN IF NOT EXISTS campaign_run_id text;
ALTER TABLE public.wbah_calls ADD COLUMN IF NOT EXISTS lead_id text;
ALTER TABLE public.wbah_calls ADD COLUMN IF NOT EXISTS provider_call_id text;

CREATE INDEX IF NOT EXISTS idx_wbah_calls_ws_campaign
  ON public.wbah_calls (workspace_id, campaign_id);
