-- ── SystemMind Workflow Intelligence ─────────────────────────────────────────
-- Four tables: workflow library, extracted patterns, repair playbooks, and
-- AI-generated workflow drafts. All workspace-scoped with RLS.
-- Safe to re-run: tables/indexes use IF NOT EXISTS; policies use
-- DROP IF EXISTS before CREATE so partial-apply states are handled cleanly.

-- 1. systemmind_workflow_library ──────────────────────────────────────────────
-- One row per (workspace, agent) — updated on each scan.
CREATE TABLE IF NOT EXISTS public.systemmind_workflow_library (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id        UUID        REFERENCES public.agents(id) ON DELETE SET NULL,
  workflow_name   TEXT        NOT NULL,
  agent_type      TEXT,
  category        TEXT,
  channel         TEXT,
  provider        TEXT,
  node_count      INTEGER     NOT NULL DEFAULT 0,
  edge_count      INTEGER     NOT NULL DEFAULT 0,
  node_types      TEXT[]      NOT NULL DEFAULT '{}',
  tool_ids        TEXT[]      NOT NULL DEFAULT '{}',
  has_webhook     BOOLEAN     NOT NULL DEFAULT FALSE,
  has_booking     BOOLEAN     NOT NULL DEFAULT FALSE,
  has_transfer    BOOLEAN     NOT NULL DEFAULT FALSE,
  has_knowledge_base BOOLEAN  NOT NULL DEFAULT FALSE,
  flow_snapshot   JSONB,
  deployment_mode TEXT,
  success_score   NUMERIC,
  last_used_at    TIMESTAMPTZ,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, agent_id)
);
CREATE INDEX IF NOT EXISTS sm_wl_ws_idx  ON public.systemmind_workflow_library(workspace_id);
CREATE INDEX IF NOT EXISTS sm_wl_cat_idx ON public.systemmind_workflow_library(category);

-- 2. systemmind_workflow_patterns ─────────────────────────────────────────────
-- AI-extracted reusable patterns per category.
CREATE TABLE IF NOT EXISTS public.systemmind_workflow_patterns (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category             TEXT        NOT NULL,
  pattern_name         TEXT        NOT NULL,
  description          TEXT,
  node_sequence        TEXT[]      NOT NULL DEFAULT '{}',
  common_tools         TEXT[]      NOT NULL DEFAULT '{}',
  common_variables     TEXT[]      NOT NULL DEFAULT '{}',
  logic_split_pattern  TEXT,
  booking_pattern      TEXT,
  transfer_pattern     TEXT,
  document_pattern     TEXT,
  example_workflow_ids UUID[]      NOT NULL DEFAULT '{}',
  confidence_score     NUMERIC     NOT NULL DEFAULT 0,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, category, pattern_name)
);
CREATE INDEX IF NOT EXISTS sm_wp_ws_idx ON public.systemmind_workflow_patterns(workspace_id);

-- 3. systemmind_repair_playbooks ───────────────────────────────────────────────
-- Repair and provider playbooks — seeded with 22 defaults, user-extensible.
CREATE TABLE IF NOT EXISTS public.systemmind_repair_playbooks (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  playbook_key   TEXT        NOT NULL,
  category       TEXT        NOT NULL DEFAULT 'repair',  -- repair | provider
  problem        TEXT        NOT NULL,
  symptoms       TEXT[]      NOT NULL DEFAULT '{}',
  checks         TEXT[]      NOT NULL DEFAULT '{}',
  fix_steps      TEXT[]      NOT NULL DEFAULT '{}',
  affected_files TEXT[]      NOT NULL DEFAULT '{}',
  risk_level     TEXT        NOT NULL DEFAULT 'medium',  -- low | medium | high | critical
  rollback_plan  TEXT,
  provider       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, playbook_key)
);
CREATE INDEX IF NOT EXISTS sm_pb_ws_idx   ON public.systemmind_repair_playbooks(workspace_id);
CREATE INDEX IF NOT EXISTS sm_pb_risk_idx ON public.systemmind_repair_playbooks(risk_level);
CREATE INDEX IF NOT EXISTS sm_pb_cat_idx  ON public.systemmind_repair_playbooks(category);

-- 4. systemmind_workflow_drafts ────────────────────────────────────────────────
-- AI-generated draft workflows — never auto-deployed (status = 'draft').
CREATE TABLE IF NOT EXISTS public.systemmind_workflow_drafts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title                TEXT        NOT NULL,
  description          TEXT,
  category             TEXT,
  status               TEXT        NOT NULL DEFAULT 'draft',
  nodes                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  edges                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  variables            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  tools                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  webhook_suggestions  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  kb_suggestions       TEXT[]      NOT NULL DEFAULT '{}',
  follow_up_suggestions TEXT[]     NOT NULL DEFAULT '{}',
  generated_by         TEXT        NOT NULL DEFAULT 'systemmind',
  source_patterns      UUID[]      NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sm_wd_ws_idx ON public.systemmind_workflow_drafts(workspace_id);

-- RLS ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.systemmind_workflow_library  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_workflow_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_repair_playbooks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_workflow_drafts   ENABLE ROW LEVEL SECURITY;

-- systemmind_workflow_library — drop-before-create for full idempotency
DROP POLICY IF EXISTS "sm_wl_sel" ON public.systemmind_workflow_library;
DROP POLICY IF EXISTS "sm_wl_ins" ON public.systemmind_workflow_library;
DROP POLICY IF EXISTS "sm_wl_upd" ON public.systemmind_workflow_library;
DROP POLICY IF EXISTS "sm_wl_del" ON public.systemmind_workflow_library;
CREATE POLICY "sm_wl_sel" ON public.systemmind_workflow_library FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wl_ins" ON public.systemmind_workflow_library FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wl_upd" ON public.systemmind_workflow_library FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wl_del" ON public.systemmind_workflow_library FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- systemmind_workflow_patterns
DROP POLICY IF EXISTS "sm_wp_sel" ON public.systemmind_workflow_patterns;
DROP POLICY IF EXISTS "sm_wp_ins" ON public.systemmind_workflow_patterns;
DROP POLICY IF EXISTS "sm_wp_upd" ON public.systemmind_workflow_patterns;
DROP POLICY IF EXISTS "sm_wp_del" ON public.systemmind_workflow_patterns;
CREATE POLICY "sm_wp_sel" ON public.systemmind_workflow_patterns FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wp_ins" ON public.systemmind_workflow_patterns FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wp_upd" ON public.systemmind_workflow_patterns FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wp_del" ON public.systemmind_workflow_patterns FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- systemmind_repair_playbooks
DROP POLICY IF EXISTS "sm_pb_sel" ON public.systemmind_repair_playbooks;
DROP POLICY IF EXISTS "sm_pb_ins" ON public.systemmind_repair_playbooks;
DROP POLICY IF EXISTS "sm_pb_upd" ON public.systemmind_repair_playbooks;
DROP POLICY IF EXISTS "sm_pb_del" ON public.systemmind_repair_playbooks;
CREATE POLICY "sm_pb_sel" ON public.systemmind_repair_playbooks FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_pb_ins" ON public.systemmind_repair_playbooks FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_pb_upd" ON public.systemmind_repair_playbooks FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_pb_del" ON public.systemmind_repair_playbooks FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- systemmind_workflow_drafts
DROP POLICY IF EXISTS "sm_wd_sel" ON public.systemmind_workflow_drafts;
DROP POLICY IF EXISTS "sm_wd_ins" ON public.systemmind_workflow_drafts;
DROP POLICY IF EXISTS "sm_wd_del" ON public.systemmind_workflow_drafts;
CREATE POLICY "sm_wd_sel" ON public.systemmind_workflow_drafts FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wd_ins" ON public.systemmind_workflow_drafts FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "sm_wd_del" ON public.systemmind_workflow_drafts FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- Grants ────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_workflow_library  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_workflow_patterns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_repair_playbooks  TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.systemmind_workflow_drafts   TO authenticated;

GRANT ALL ON public.systemmind_workflow_library  TO service_role;
GRANT ALL ON public.systemmind_workflow_patterns TO service_role;
GRANT ALL ON public.systemmind_repair_playbooks  TO service_role;
GRANT ALL ON public.systemmind_workflow_drafts   TO service_role;
