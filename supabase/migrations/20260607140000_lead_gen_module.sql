-- Lead Generation module: intelligence fields on leads, campaigns table, campaign_id on data_records

-- Add lead intelligence columns to leads table (all nullable, safe to add)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS call_summary           TEXT,
  ADD COLUMN IF NOT EXISTS interest_level         TEXT,
  ADD COLUMN IF NOT EXISTS buying_intent          TEXT,
  ADD COLUMN IF NOT EXISTS lead_score             INTEGER,
  ADD COLUMN IF NOT EXISTS objections             TEXT,
  ADD COLUMN IF NOT EXISTS next_action            TEXT,
  ADD COLUMN IF NOT EXISTS meeting_requested      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS callback_date          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_maker_status  TEXT;

-- Campaigns table: groups data_records into named outbound campaigns
CREATE TABLE IF NOT EXISTS public.campaigns (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      UUID        REFERENCES public.agents(id) ON DELETE SET NULL,
  name          TEXT        NOT NULL,
  description   TEXT,
  status        TEXT        NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_workspace_id_idx ON public.campaigns(workspace_id);

-- Add campaign_id to data_records so records can belong to a campaign
ALTER TABLE public.data_records
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS data_records_campaign_id_idx ON public.data_records(campaign_id);

-- RLS for campaigns (workspace-scoped, same pattern as rest of app)
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_workspace_member" ON public.campaigns;
CREATE POLICY "campaigns_workspace_member" ON public.campaigns
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
