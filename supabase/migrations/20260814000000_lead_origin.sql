-- ============================================================
-- Lead Origin: canonical lead_origin + origin_provider columns
-- ============================================================
-- Adds two nullable text columns that record HOW a lead first
-- entered WEBEE, independent of campaigns, status, and sentiment.
--
-- lead_origin  : canonical channel (whatsapp | voice_call | web_form |
--                manual | csv_import | crm | email | sms | campaign |
--                api | unknown)
-- origin_provider : specific provider string (WATI, WEBEE Voice, etc.)
--
-- The existing `source` enum is NOT touched — these are additive columns.
-- ------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_origin   text,
  ADD COLUMN IF NOT EXISTS origin_provider text;

-- Backfill from existing evidence (idempotent — only updates NULL rows)
-- Evidence priority:
--   1. buzzchat_conversation_id set                → whatsapp / WATI
--   2. source = 'whatsapp'                         → whatsapp / WATI
--   3. source = 'retell' (schema-drift usage)      → voice_call / WEBEE Voice
--   4. meta->>'wbah_source' = 'wbah_calls'         → voice_call / WEBEE Voice
--   5. meta->>'wbah_source' = 'crm'               → crm / WeeBespoke
--   6. source in web-form family                  → web_form / Website
--   7. source = 'import'                          → csv_import / CSV
--   8. source in (inbound, outbound, referral)    → crm / CRM
--   9. source = 'api'                             → api / API
--  10. anything else                              → unknown

UPDATE leads
SET
  lead_origin = CASE
    WHEN buzzchat_conversation_id IS NOT NULL                    THEN 'whatsapp'
    WHEN source::text = 'whatsapp'                               THEN 'whatsapp'
    WHEN source::text = 'retell'                                 THEN 'voice_call'
    WHEN meta->>'wbah_source' = 'wbah_calls'                    THEN 'voice_call'
    WHEN meta->>'wbah_source' = 'crm'                           THEN 'crm'
    WHEN source::text IN (
      'website_form','landing_page','facebook_lead_form',
      'google_ads_lead_form','tiktok_lead_form','linkedin_lead_form',
      'custom_form','webee_website_form','zapier','make','website'
    )                                                            THEN 'web_form'
    WHEN source::text = 'import'                                 THEN 'csv_import'
    WHEN source::text IN ('inbound','outbound','referral')       THEN 'crm'
    WHEN source::text = 'api'                                    THEN 'api'
    ELSE                                                              'unknown'
  END,
  origin_provider = CASE
    WHEN buzzchat_conversation_id IS NOT NULL                    THEN 'WATI'
    WHEN source::text = 'whatsapp'                               THEN 'WATI'
    WHEN source::text = 'retell'                                 THEN 'WEBEE Voice'
    WHEN meta->>'wbah_source' = 'wbah_calls'                    THEN 'WEBEE Voice'
    WHEN meta->>'wbah_source' = 'crm'                           THEN 'WeeBespoke'
    WHEN source::text IN (
      'website_form','landing_page','facebook_lead_form',
      'google_ads_lead_form','tiktok_lead_form','linkedin_lead_form',
      'custom_form','webee_website_form','zapier','make','website'
    )                                                            THEN 'Website'
    WHEN source::text = 'import'                                 THEN 'CSV'
    WHEN source::text IN ('inbound','outbound','referral')       THEN 'CRM'
    WHEN source::text = 'api'                                    THEN 'API'
    ELSE NULL
  END
WHERE lead_origin IS NULL;

-- Partial index speeds up origin-based filtering queries.
CREATE INDEX IF NOT EXISTS leads_lead_origin_ws_idx
  ON leads (workspace_id, lead_origin)
  WHERE lead_origin IS NOT NULL;
