-- =====================================================================
-- WBAH CALLS TABLE
-- Stores WeeBespoke call-history records so the Calls page reads from
-- DB instantly instead of live-fetching 10,000+ records from the API.
--
-- Apply in Supabase SQL Editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS wbah_calls (
  id                   text PRIMARY KEY,
  workspace_id         uuid NOT NULL,
  customer_name        text,
  phone                text,
  agent_name           text,
  call_status          text,
  call_type            text DEFAULT 'outbound',
  sentiment            text,
  duration_seconds     integer,
  started_at           timestamptz,
  recording_url        text,
  transcript           text,
  call_summary         text,
  disconnection_reason text,
  end_reason           text,
  appointment_date     text,
  appointment_time     text,
  booking_status       text,
  calendly_booking_url text,
  call_count           integer DEFAULT 1,
  meta                 jsonb DEFAULT '{}',
  synced_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wbah_calls_workspace
  ON wbah_calls (workspace_id);

CREATE INDEX IF NOT EXISTS idx_wbah_calls_started
  ON wbah_calls (workspace_id, started_at DESC NULLS LAST);

ALTER TABLE wbah_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can view wbah_calls"
  ON wbah_calls FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
