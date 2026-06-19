-- WBAH Categorized Leads Migration
-- Apply in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Creates tables for categorized lead sync: Disqualified, Tried To Contact, Rebooking

-- ── 1. wbah_categorized_leads ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wbah_categorized_leads (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL,
  external_lead_id      text NOT NULL,
  external_source       text NOT NULL DEFAULT 'webuyanyhouse_dashboard',
  external_status_code  text,
  external_status_label text,
  webee_category        text NOT NULL CHECK (webee_category IN ('disqualified', 'tried_to_contact', 'rebooking')),
  full_name             text,
  first_name            text,
  last_name             text,
  phone                 text,
  email                 text,
  address               text,
  city                  text,
  postcode              text,
  property_type         text,
  meta                  jsonb DEFAULT '{}',
  created_at            timestamptz DEFAULT now(),
  last_synced_at        timestamptz DEFAULT now(),
  UNIQUE (workspace_id, external_lead_id)
);

CREATE INDEX IF NOT EXISTS wbah_categorized_leads_workspace_id_idx
  ON wbah_categorized_leads (workspace_id);

CREATE INDEX IF NOT EXISTS wbah_categorized_leads_category_idx
  ON wbah_categorized_leads (workspace_id, webee_category);

-- ── 2. wbah_category_sync_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wbah_category_sync_log (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          uuid NOT NULL,
  category              text NOT NULL,
  synced_at             timestamptz DEFAULT now(),
  imported              integer DEFAULT 0,
  updated               integer DEFAULT 0,
  skipped               integer DEFAULT 0,
  failed                integer DEFAULT 0,
  total_records         integer DEFAULT 0,
  external_status_codes text[],
  endpoint_used         text,
  error_message         text,
  duration_ms           integer
);

CREATE INDEX IF NOT EXISTS wbah_category_sync_log_workspace_category_idx
  ON wbah_category_sync_log (workspace_id, category, synced_at DESC);
