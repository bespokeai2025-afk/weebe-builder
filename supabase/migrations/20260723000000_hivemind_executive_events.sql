-- HiveMind Executive OS — Stage 1: unified executive event stream +
-- reconciliation state. Additive & idempotent. Apply via
-- scripts/apply-executive-events-migration.mjs (Supabase Management API).

-- ── Executive event stream ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hivemind_executive_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL,
  source_system     TEXT        NOT NULL DEFAULT 'platform',
  severity          TEXT        NOT NULL DEFAULT 'info'
                                CHECK (severity IN ('info','warning','critical')),
  title             TEXT        NOT NULL,
  summary           TEXT,
  entity_type       TEXT,
  entity_id         TEXT,
  dedup_key         TEXT        NOT NULL,
  correlation_key   TEXT,
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (processing_status IN ('pending','classified','consumed','discarded')),
  classification    TEXT
                                CHECK (classification IS NULL OR classification IN
                                ('informational','briefing','recommendation_candidate','task_candidate','warning','critical')),
  classified_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hard dedup guarantee: same workspace + dedup key can only exist once.
CREATE UNIQUE INDEX IF NOT EXISTS hivemind_executive_events_dedup_uq
  ON hivemind_executive_events (workspace_id, dedup_key);

CREATE INDEX IF NOT EXISTS hivemind_executive_events_ws_recent
  ON hivemind_executive_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS hivemind_executive_events_pending
  ON hivemind_executive_events (processing_status, created_at)
  WHERE processing_status = 'pending';

ALTER TABLE hivemind_executive_events ENABLE ROW LEVEL SECURITY;

-- Members can read their workspace's events. Writes are server-only
-- (service role bypasses RLS); revoke default grants so authenticated
-- users can never insert/update/delete.
DO $$ BEGIN
  CREATE POLICY "hm_exec_events_select" ON hivemind_executive_events
    FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE INSERT, UPDATE, DELETE ON hivemind_executive_events FROM authenticated;
REVOKE ALL ON hivemind_executive_events FROM anon;

-- ── Reconciliation job state (per workspace × job, CAS-claimed) ───────────────
CREATE TABLE IF NOT EXISTS hivemind_reconciliation_state (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_key       TEXT        NOT NULL,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,
  last_detail   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hivemind_reconciliation_state_uq
  ON hivemind_reconciliation_state (workspace_id, job_key);

ALTER TABLE hivemind_reconciliation_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "hm_recon_state_select" ON hivemind_reconciliation_state
    FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE INSERT, UPDATE, DELETE ON hivemind_reconciliation_state FROM authenticated;
REVOKE ALL ON hivemind_reconciliation_state FROM anon;
