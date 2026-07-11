-- ─────────────────────────────────────────────────────────────────────────────
-- SystemMind Generators — WhatsApp setup drafts, follow-up sequence drafts,
-- n8n→WEBEE workflow blueprints (Task #320).
--
-- Detail tables for the SystemMind Automation Layer hub
-- (systemmind_generated_actions). Lifecycle status lives ONLY on the hub row —
-- these tables store kind-specific structured detail linked by
-- generated_action_id (hub-and-detail, single source of truth for status).
--
--   whatsapp_setup_drafts      — provider setup drafts (twilio | wati | meta)
--   follow_up_sequence_drafts  — multi-day follow-up sequences (compile to
--                                hexmail campaigns on activation)
--   workflow_blueprints        — n8n→WEBEE converted blueprints + mapping report
--
-- Additive + idempotent: safe to re-run. Apply manually to the shared Supabase
-- DB (Management API via scripts/apply-systemmind-generators-migration.mjs, or
-- the SQL Editor).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. whatsapp_setup_drafts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_setup_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL,
  generated_action_id  UUID NOT NULL UNIQUE
                       REFERENCES public.systemmind_generated_actions(id) ON DELETE CASCADE,
  created_by_user_id   UUID,
  provider             TEXT NOT NULL CHECK (provider IN ('twilio','wati','meta')),
  -- Ordered setup checklist: [{ order, title, details, requires_credentials,
  --   credential_names[] }] — credential NAMES only, never values.
  setup_steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { inbound_url, verify_hint, notes } — URLs/instructions only, no secrets.
  webhook_config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { agent_id | null, agent_name | null, notes }
  agent_binding        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ name, language, body, variables[] }]
  message_templates    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_setup_drafts_ws_created
  ON public.whatsapp_setup_drafts (workspace_id, created_at DESC);

ALTER TABLE public.whatsapp_setup_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_setup_drafts_members" ON public.whatsapp_setup_drafts;
CREATE POLICY "wa_setup_drafts_members" ON public.whatsapp_setup_drafts
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.whatsapp_setup_drafts FROM authenticated;
GRANT SELECT ON public.whatsapp_setup_drafts TO authenticated;

-- ── 2. follow_up_sequence_drafts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.follow_up_sequence_drafts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL,
  generated_action_id    UUID NOT NULL UNIQUE
                         REFERENCES public.systemmind_generated_actions(id) ON DELETE CASCADE,
  created_by_user_id     UUID,
  name                   TEXT NOT NULL,
  purpose                TEXT,
  -- [{ day_number, channel(email|whatsapp|sms|ai_call|task|notification),
  --    title, message, notes }]
  sequence               JSONB NOT NULL DEFAULT '[]'::jsonb,
  stop_conditions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_statuses        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Pre-compiled hexmail campaign preview: { campaign: {...}, steps: [...] }
  compiled_campaign      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Set at activation time (hexmail_campaigns.id)
  activated_campaign_id  UUID,
  is_deleted             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fu_seq_drafts_ws_created
  ON public.follow_up_sequence_drafts (workspace_id, created_at DESC);

ALTER TABLE public.follow_up_sequence_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fu_seq_drafts_members" ON public.follow_up_sequence_drafts;
CREATE POLICY "fu_seq_drafts_members" ON public.follow_up_sequence_drafts
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.follow_up_sequence_drafts FROM authenticated;
GRANT SELECT ON public.follow_up_sequence_drafts TO authenticated;

-- ── 3. workflow_blueprints (n8n → WEBEE conversion) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_blueprints (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL,
  generated_action_id    UUID UNIQUE
                         REFERENCES public.systemmind_generated_actions(id) ON DELETE CASCADE,
  created_by_user_id     UUID,
  source                 TEXT NOT NULL DEFAULT 'n8n' CHECK (source IN ('n8n','manual')),
  -- Reference to the discovery row (systemmind_n8n_workflows.id) + n8n identifiers.
  source_row_id          UUID,
  source_workflow_id     TEXT,
  source_name            TEXT,
  -- WEBEE-native blueprint: { name, trigger_type, trigger_config, steps: [...] }
  blueprint              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { converted: [{n8n_node, n8n_type, webee_step}], unconvertible: [{node,
  --   type, reason}], warnings: [] } — unconvertible nodes are NEVER dropped
  --   silently.
  mapping_report         JSONB NOT NULL DEFAULT '{}'::jsonb,
  unconvertible_count    INTEGER NOT NULL DEFAULT 0,
  -- Workspace-private by default; 'global' reserved for explicit WEBEE-admin
  -- approval flows (not writable by any current code path).
  visibility             TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace','global')),
  -- Set at activation time (workspace_workflows.id)
  activated_workflow_id  UUID,
  is_deleted             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_blueprints_ws_created
  ON public.workflow_blueprints (workspace_id, created_at DESC);

ALTER TABLE public.workflow_blueprints ENABLE ROW LEVEL SECURITY;

-- Workspace members can read their own workspace's blueprints only. 'global'
-- visibility intentionally has NO read path here yet — cross-workspace sharing
-- requires an explicit admin-approval feature (out of scope).
DROP POLICY IF EXISTS "wf_blueprints_members" ON public.workflow_blueprints;
CREATE POLICY "wf_blueprints_members" ON public.workflow_blueprints
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.workflow_blueprints FROM authenticated;
GRANT SELECT ON public.workflow_blueprints TO authenticated;

-- ── 4. updated_at triggers (reuse the automation-layer trigger fn) ────────────
CREATE OR REPLACE FUNCTION public.sm_automation_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wa_setup_drafts_updated_at ON public.whatsapp_setup_drafts;
CREATE TRIGGER wa_setup_drafts_updated_at
  BEFORE UPDATE ON public.whatsapp_setup_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

DROP TRIGGER IF EXISTS fu_seq_drafts_updated_at ON public.follow_up_sequence_drafts;
CREATE TRIGGER fu_seq_drafts_updated_at
  BEFORE UPDATE ON public.follow_up_sequence_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

DROP TRIGGER IF EXISTS wf_blueprints_updated_at ON public.workflow_blueprints;
CREATE TRIGGER wf_blueprints_updated_at
  BEFORE UPDATE ON public.workflow_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.sm_automation_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- End of SystemMind Generators migration
-- ─────────────────────────────────────────────────────────────────────────────
