-- Campaign Type routing key — Avenue Elite Properties multi-business CRM.
-- Adds a required business-type routing key to whatsapp_campaigns so one
-- Campaign object can drive Listing Acquisition, Off-Plan, and Secondary
-- workflows instead of three disconnected systems. Existing rows default to
-- 'listing_acquisition' so current campaigns (all workspaces) keep working
-- unchanged.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'listing_acquisition';

ALTER TABLE public.whatsapp_campaigns
  DROP CONSTRAINT IF EXISTS whatsapp_campaigns_campaign_type_check;

ALTER TABLE public.whatsapp_campaigns
  ADD CONSTRAINT whatsapp_campaigns_campaign_type_check
  CHECK (campaign_type IN ('listing_acquisition', 'off_plan', 'secondary'));

-- Type-specific campaign context (Developer/Project/Area for Off-Plan,
-- Area/Bedrooms for Secondary, etc.) — flexible JSONB, same pattern as
-- leads.meta, so it never needs another migration when fields are added.
ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS type_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS whatsapp_campaigns_campaign_type_idx
  ON public.whatsapp_campaigns (workspace_id, campaign_type);
