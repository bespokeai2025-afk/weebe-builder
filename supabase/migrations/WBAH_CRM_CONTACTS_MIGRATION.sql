-- =====================================================================
-- WBAH CRM CONTACTS TABLE
-- Persists the WeeBespoke "get-all-calldata" People feed into Supabase so the
-- People section (Disqualified / Tried To Contact / Rebook Initial Consultation
-- / …) reads from Supabase (source of truth) instead of a live, single-session
-- WeeBespoke fetch that blanks the tab when the session is invalidated.
--
-- Each row is one CRM-loaded contact, deduped by phone (latest load wins).
-- `lead_status` is the WeeBespoke Lead Filter Master category that drives the
-- People sub-tabs.
--
-- Apply in the Supabase SQL Editor (or via `supabase db push`).
-- =====================================================================

CREATE TABLE IF NOT EXISTS wbah_crm_contacts (
  -- Stable upsert identity: phone when present, else "id:<external id>".
  dedup_key            text        NOT NULL,
  workspace_id         uuid        NOT NULL,

  external_id          text,                       -- source lead_id / callId / id
  phone                text,
  name                 text,
  email                text,

  lead_status          text,                       -- Lead Filter Master category
  call_status          text,
  sentiment            text,
  disconnection_reason text,
  end_reason           text,

  agent_name           text,
  duration_ms          bigint,
  start_timestamp      bigint,
  recording_url        text,
  transcript           text,

  appointment_date     text,
  appointment_time     text,
  booking_status       text,
  calendly_booking_url text,

  crm_loaded_at        timestamptz,                -- source createdAt
  meta                 jsonb        DEFAULT '{}',
  synced_at            timestamptz  DEFAULT now(),

  PRIMARY KEY (workspace_id, dedup_key)
);

-- Category filtering (People sub-tabs) and booked-exclusion.
CREATE INDEX IF NOT EXISTS idx_wbah_crm_contacts_workspace
  ON wbah_crm_contacts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_wbah_crm_contacts_status
  ON wbah_crm_contacts (workspace_id, lead_status);

CREATE INDEX IF NOT EXISTS idx_wbah_crm_contacts_booking
  ON wbah_crm_contacts (workspace_id, booking_status);

CREATE INDEX IF NOT EXISTS idx_wbah_crm_contacts_loaded
  ON wbah_crm_contacts (workspace_id, crm_loaded_at DESC NULLS LAST);

ALTER TABLE wbah_crm_contacts ENABLE ROW LEVEL SECURITY;

-- Workspace members can read their workspace's contacts. Writes happen only via
-- the server (service role), which bypasses RLS — so no INSERT/UPDATE policy is
-- needed for the app.
DROP POLICY IF EXISTS "workspace members can view wbah_crm_contacts" ON wbah_crm_contacts;
CREATE POLICY "workspace members can view wbah_crm_contacts"
  ON wbah_crm_contacts FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
