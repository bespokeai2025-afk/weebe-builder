-- Migration: capture Google Ads keyword (ValueTrack {keyword}) on leads and
-- conversion events.
--
-- Google Ads auto-tagging passes the matched keyword as a URL parameter when
-- the campaign is configured with ValueTrack {keyword}. We now read it from
-- the webform/contact-form payload alongside gclid/gbraid and store it so
-- attribution reports can show which search term drove a lead.

-- 1. leads table — keyword that was matched to the Google Ads click.
alter table public.leads
  add column if not exists keyword text;

-- 2. conversion_events table — same keyword forwarded from the lead/form.
alter table public.conversion_events
  add column if not exists keyword text;

-- Index for analytics queries grouping/filtering by keyword.
create index if not exists leads_keyword_ws_idx
  on public.leads (workspace_id, keyword)
  where keyword is not null;
