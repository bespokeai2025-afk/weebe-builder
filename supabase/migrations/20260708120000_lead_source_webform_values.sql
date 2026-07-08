-- Webform lead intake fix: the public webform endpoint writes source_type into
-- leads.source (enum lead_source), but the enum only contained
-- {website, inbound, outbound, referral, import}. Any webform configured with
-- e.g. "website_form" failed with:
--   invalid input value for enum lead_source: "website_form"
-- Adds all standard webform source types to the enum.
-- Also adds 'api' for the developer API endpoints (/api/v1/contacts,
-- /api/v1/campaigns), which had the same bug.
-- APPLIED 2026-07-08 via Supabase Management API (dev == prod DB).

ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'website_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'landing_page';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'facebook_lead_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'google_ads_lead_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'tiktok_lead_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'linkedin_lead_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'zapier';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'make';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'custom_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'webee_website_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'api';
