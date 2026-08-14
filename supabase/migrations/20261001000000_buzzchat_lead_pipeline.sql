-- ============================================================
-- BuzzChat → CRM Lead Pipeline
-- Adds canonical BuzzChat state to the leads table so inbound
-- WhatsApp replies surface directly in the CRM pipeline.
-- ============================================================

-- 1. Extend lead_source enum with 'whatsapp' value.
-- (ALTER TYPE ADD VALUE cannot run inside a function/DO block;
--  it is safe at statement level inside a transaction in PG12+.)
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'whatsapp';

-- 2. Add BuzzChat state columns to leads (all additive / backwards-safe).
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS has_buzzchat_reply    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_buzzchat_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS buzzchat_conversation_id TEXT;

-- 3. Partial index: fast lookup of replied leads per workspace.
CREATE INDEX IF NOT EXISTS leads_buzzchat_replied_idx
  ON leads (workspace_id)
  WHERE has_buzzchat_reply = TRUE;

-- 4. Lookup index: given a conversation_id, find the linked lead fast.
CREATE INDEX IF NOT EXISTS leads_buzzchat_conv_idx
  ON leads (workspace_id, buzzchat_conversation_id)
  WHERE buzzchat_conversation_id IS NOT NULL;
