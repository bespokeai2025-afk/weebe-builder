-- ── Custom Agent Configs + Admin Change Requests ──────────────────────────────
-- Migration: 20260717000003
-- Apply manually in Supabase SQL Editor.
--
-- Adds two tables:
--   custom_agent_configs    — stores Option B deployment analysis output per agent
--   admin_change_requests   — stores admin billable change requests from SystemMind

-- ── 1. custom_agent_configs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_agent_configs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id                  UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  title                     TEXT NOT NULL DEFAULT 'Untitled Config',
  source_script             TEXT,
  crm_mode                  TEXT NOT NULL DEFAULT 'webee',
  -- 'webee' | 'existing_crm' | 'webhook_only' | 'none'
  deployment_readiness_score INTEGER DEFAULT 0,
  agent_summary             TEXT,
  required_variables        JSONB DEFAULT '[]'::jsonb,
  extraction_fields         JSONB DEFAULT '[]'::jsonb,
  outcome_schema            JSONB DEFAULT '[]'::jsonb,
  crm_field_mapping         JSONB DEFAULT '{}'::jsonb,
  calendar_mapping          JSONB DEFAULT '{}'::jsonb,
  webhook_payload_schema    JSONB DEFAULT '{}'::jsonb,
  required_tools            JSONB DEFAULT '[]'::jsonb,
  missing_capabilities      JSONB DEFAULT '[]'::jsonb,
  go_live_checklist         JSONB DEFAULT '[]'::jsonb,
  deployment_config         JSONB DEFAULT '{}'::jsonb,
  status                    TEXT NOT NULL DEFAULT 'draft',
  -- 'draft' | 'ready' | 'deployed'
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cac_ws_idx    ON public.custom_agent_configs(workspace_id);
CREATE INDEX IF NOT EXISTS cac_agent_idx ON public.custom_agent_configs(agent_id);

ALTER TABLE public.custom_agent_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cac_sel" ON public.custom_agent_configs;
DROP POLICY IF EXISTS "cac_ins" ON public.custom_agent_configs;
DROP POLICY IF EXISTS "cac_upd" ON public.custom_agent_configs;
DROP POLICY IF EXISTS "cac_del" ON public.custom_agent_configs;

CREATE POLICY "cac_sel" ON public.custom_agent_configs FOR SELECT
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));
CREATE POLICY "cac_ins" ON public.custom_agent_configs FOR INSERT
  WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));
CREATE POLICY "cac_upd" ON public.custom_agent_configs FOR UPDATE
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));
CREATE POLICY "cac_del" ON public.custom_agent_configs FOR DELETE
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_agent_configs TO authenticated;


-- ── 2. admin_change_requests ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_change_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by        UUID REFERENCES auth.users(id),
  source_agent_id     UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  source_config_id    UUID REFERENCES public.custom_agent_configs(id) ON DELETE SET NULL,
  request_type        TEXT NOT NULL DEFAULT 'custom_tool',
  -- 'custom_extraction' | 'crm_field' | 'webhook_transformer' | 'custom_tool'
  -- 'unsupported_provider' | 'custom_builder_node' | 'custom_automation'
  title               TEXT NOT NULL,
  missing_capability  TEXT,
  technical_summary   TEXT,
  estimated_effort    TEXT,
  billable            BOOLEAN DEFAULT true,
  billing_status      TEXT NOT NULL DEFAULT 'pending_quote',
  -- 'pending_quote' | 'quoted' | 'approved' | 'declined'
  quote_amount_pence  INTEGER,
  status              TEXT NOT NULL DEFAULT 'open',
  -- 'open' | 'in_progress' | 'resolved' | 'declined'
  admin_notes         TEXT,
  reviewed_by         UUID REFERENCES auth.users(id),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acr_ws_idx     ON public.admin_change_requests(workspace_id);
CREATE INDEX IF NOT EXISTS acr_status_idx ON public.admin_change_requests(status);
CREATE INDEX IF NOT EXISTS acr_billing_idx ON public.admin_change_requests(billing_status);

ALTER TABLE public.admin_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acr_sel_own" ON public.admin_change_requests;
DROP POLICY IF EXISTS "acr_ins_own" ON public.admin_change_requests;
DROP POLICY IF EXISTS "acr_sel_admin" ON public.admin_change_requests;
DROP POLICY IF EXISTS "acr_upd_admin" ON public.admin_change_requests;

-- Workspace owners can view/create their own requests
CREATE POLICY "acr_sel_own" ON public.admin_change_requests FOR SELECT
  USING (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));
CREATE POLICY "acr_ins_own" ON public.admin_change_requests FOR INSERT
  WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()));

-- Admins can view and update all requests (via service role in server fns)
-- Server fns use supabaseAdmin (service role) so RLS bypassed there

GRANT SELECT, INSERT ON public.admin_change_requests TO authenticated;
