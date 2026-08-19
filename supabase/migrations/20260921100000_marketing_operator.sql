-- Task: HiveMind marketing operator — objectives, daily checks, measure & learn.
-- Additive & idempotent. Apply via the Supabase Management API.

-- ── 1. marketing_objectives ──────────────────────────────────────────────────
-- Structured, measurable objectives created from HiveMind chat commands.
CREATE TABLE IF NOT EXISTS marketing_objectives (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title              TEXT        NOT NULL,
  command_text       TEXT,                          -- original plain-language command
  metric             TEXT        NOT NULL,          -- e.g. qualified_opportunities, booked_demos, wasted_spend, cpa
  metric_source      TEXT        NOT NULL DEFAULT 'conversion_events', -- conversion_events | google_ads | gsc | clarity | bookings
  baseline           JSONB       NOT NULL DEFAULT '{}'::jsonb, -- snapshot at creation {value, window_days, computed_at, detail}
  target             JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {direction: increase|decrease, value?, pct?, deadline?}
  constraints        JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{metric, rule, value, label}] e.g. maintain CPA
  status             TEXT        NOT NULL DEFAULT 'active',
  priority           INTEGER     NOT NULL DEFAULT 3,           -- 1 (highest) .. 5
  created_by_user_id UUID,
  work_order_ids     JSONB       NOT NULL DEFAULT '[]'::jsonb, -- delegated work orders
  last_review        JSONB,                                    -- latest seven-section status snapshot
  last_reviewed_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_objectives_status_ck') THEN
    ALTER TABLE marketing_objectives
      ADD CONSTRAINT marketing_objectives_status_ck
      CHECK (status IN ('active','paused','achieved','not_achieved','abandoned'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS marketing_objectives_ws_status_idx
  ON marketing_objectives (workspace_id, status, created_at DESC);

ALTER TABLE marketing_objectives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketing_objectives FROM authenticated;
REVOKE ALL ON marketing_objectives FROM anon;
GRANT SELECT ON marketing_objectives TO authenticated;

DROP POLICY IF EXISTS marketing_objectives_member_read ON marketing_objectives;
CREATE POLICY marketing_objectives_member_read
  ON marketing_objectives FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- ── 2. marketing_actions — objective link + measurement window columns ──────
ALTER TABLE marketing_actions
  ADD COLUMN IF NOT EXISTS objective_id           UUID,
  ADD COLUMN IF NOT EXISTS baseline               JSONB,
  ADD COLUMN IF NOT EXISTS reassess_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome                JSONB,
  ADD COLUMN IF NOT EXISTS outcome_classification TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_actions_outcome_class_ck') THEN
    ALTER TABLE marketing_actions
      ADD CONSTRAINT marketing_actions_outcome_class_ck
      CHECK (outcome_classification IS NULL OR outcome_classification IN
        ('successful','partial','no_change','unsuccessful','inconclusive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS marketing_actions_objective_idx
  ON marketing_actions (objective_id) WHERE objective_id IS NOT NULL;

-- Measurement sweep scan: executed/verified actions awaiting outcome classification.
CREATE INDEX IF NOT EXISTS marketing_actions_reassess_idx
  ON marketing_actions (reassess_at)
  WHERE reassess_at IS NOT NULL AND outcome_classification IS NULL
    AND status IN ('executed','verified','measuring','success');

-- ── 3. marketing_operator_findings ──────────────────────────────────────────
-- Daily operator findings (adequate-data-threshold observations + digest fodder).
CREATE TABLE IF NOT EXISTS marketing_operator_findings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_date            DATE        NOT NULL,
  finding_kind        TEXT        NOT NULL,   -- e.g. wasted_spend, conversion_drop, ux_friction, action_completed, approval_pending
  severity            TEXT        NOT NULL DEFAULT 'info', -- info | attention | critical
  title               TEXT        NOT NULL,
  detail              TEXT,
  data                JSONB       NOT NULL DEFAULT '{}'::jsonb, -- raw evidence (never invented)
  objective_id        UUID,
  marketing_action_id UUID,
  status              TEXT        NOT NULL DEFAULT 'open',      -- open | actioned | dismissed | expired
  dedupe_key          TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_operator_findings_status_ck') THEN
    ALTER TABLE marketing_operator_findings
      ADD CONSTRAINT marketing_operator_findings_status_ck
      CHECK (status IN ('open','actioned','dismissed','expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_operator_findings_severity_ck') THEN
    ALTER TABLE marketing_operator_findings
      ADD CONSTRAINT marketing_operator_findings_severity_ck
      CHECK (severity IN ('info','attention','critical'));
  END IF;
END $$;

-- One live finding per (workspace, dedupe_key) — no daily duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_operator_findings_live_uq
  ON marketing_operator_findings (workspace_id, dedupe_key)
  WHERE status IN ('open','actioned');

CREATE INDEX IF NOT EXISTS marketing_operator_findings_ws_idx
  ON marketing_operator_findings (workspace_id, status, created_at DESC);

ALTER TABLE marketing_operator_findings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketing_operator_findings FROM authenticated;
REVOKE ALL ON marketing_operator_findings FROM anon;
GRANT SELECT ON marketing_operator_findings TO authenticated;

DROP POLICY IF EXISTS marketing_operator_findings_member_read ON marketing_operator_findings;
CREATE POLICY marketing_operator_findings_member_read
  ON marketing_operator_findings FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- ── 4. workspace_settings — operator enablement + CAS-claim timestamp ───────
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS marketing_operator_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_operator_last_run_at TIMESTAMPTZ;

-- ── 5. Notification event key: marketing_operator_digest ────────────────────
ALTER TABLE workspace_notification_settings
  DROP CONSTRAINT workspace_notification_settings_event_key_check;

ALTER TABLE workspace_notification_settings
  ADD CONSTRAINT workspace_notification_settings_event_key_check
  CHECK (event_key = ANY (ARRAY[
    'launched','activated','paused','completed','failed','safety_blocked',
    'no_eligible_leads','daily_cap_hit','safety_cap_hit','provider_error',
    'workflow_error','kpi_report_ready','high_negative_sentiment',
    'high_positive_performance','qualified_leads_generated','appointments_booked',
    'follow_up_tasks_created','needs_admin_attention','staff_invite_accepted',
    'systemmind_fix_suggested','reseller_client_created','email_provider_failing',
    'lead_created','whatsapp_reply_received','marketing_operator_digest'
  ]));
