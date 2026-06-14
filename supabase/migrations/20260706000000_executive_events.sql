-- Executive Council: shared executive event log
-- Records briefing summaries + escalations from both HiveMind (COO) and GrowthMind (CMO).
-- Apply in Supabase SQL Editor (DDL cannot run through the Supabase JS client here).

CREATE TABLE IF NOT EXISTS executive_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT        NOT NULL DEFAULT 'hivemind'
                           CHECK (source IN ('hivemind','growthmind')),
  event_type   TEXT        NOT NULL,
  summary      TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info'
                           CHECK (severity IN ('info','warning','critical')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS executive_events_ws_recent
  ON executive_events (workspace_id, created_at DESC);

-- Dedup support: same source + event_type within a recent window.
CREATE INDEX IF NOT EXISTS executive_events_dedup
  ON executive_events (workspace_id, source, event_type, created_at DESC);

-- ── Row Level Security ─────────────────────────────────────────────────────────
ALTER TABLE executive_events ENABLE ROW LEVEL SECURITY;

-- Pattern: workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
CREATE POLICY "executive_events_select" ON executive_events
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "executive_events_insert" ON executive_events
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "executive_events_update" ON executive_events
  FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "executive_events_delete" ON executive_events
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
