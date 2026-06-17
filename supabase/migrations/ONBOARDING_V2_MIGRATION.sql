-- ── Onboarding V2 Migration ───────────────────────────────────────────────────
-- Tracks per-workspace onboarding path and completion.
-- Apply in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS workspace_onboarding (
  workspace_id        UUID        PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES auth.users(id),
  path                TEXT        NULL CHECK (path IN ('agent_builder', 'grow', 'both')),
  completed           BOOLEAN     NOT NULL DEFAULT false,
  dismissed           BOOLEAN     NOT NULL DEFAULT false,
  -- Completion flags
  business_dna_done   BOOLEAN     NOT NULL DEFAULT false,
  knowledge_uploaded  BOOLEAN     NOT NULL DEFAULT false,
  connections_done    BOOLEAN     NOT NULL DEFAULT false,
  first_agent_done    BOOLEAN     NOT NULL DEFAULT false,
  first_campaign_done BOOLEAN     NOT NULL DEFAULT false,
  analysis_done       BOOLEAN     NOT NULL DEFAULT false,
  telephony_done      BOOLEAN     NOT NULL DEFAULT false,
  -- Metadata
  crm_choice          TEXT        NULL CHECK (crm_choice IN ('smart_dash', 'external', 'skip')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspace_onboarding ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "onboarding_own_workspace" ON workspace_onboarding
    FOR ALL USING (
      workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Done ──────────────────────────────────────────────────────────────────────
