-- Telephony Layer: provider-agnostic PSTN call infrastructure
-- Completely separate from Retell; Retell tables and routes are untouched.

-- ── Provider configurations (one per workspace) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.telephony_configs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider          text        NOT NULL DEFAULT 'twilio',  -- twilio | telnyx | plivo | vonage
  account_sid       text,       -- Twilio Account SID
  auth_token        text,       -- Twilio Auth Token
  api_key           text,       -- Twilio API Key SID (optional, for better key hygiene)
  api_secret        text,       -- Twilio API Key Secret
  is_active         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

ALTER TABLE public.telephony_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members manage telephony_configs"
  ON public.telephony_configs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

-- ── Phone numbers owned by workspaces ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telephony_config_id uuid        REFERENCES public.telephony_configs(id) ON DELETE SET NULL,
  phone_number        text        NOT NULL,               -- E.164, e.g. +14155552671
  friendly_name       text,
  provider            text        NOT NULL DEFAULT 'twilio',
  provider_sid        text,                               -- Twilio IncomingPhoneNumber SID
  agent_id            uuid        REFERENCES public.agents(id) ON DELETE SET NULL,
  capabilities        jsonb       NOT NULL DEFAULT '{"voice":true,"sms":false}',
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members manage phone_numbers"
  ON public.phone_numbers FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

-- ── Outbound call campaigns ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id         uuid        REFERENCES public.agents(id) ON DELETE SET NULL,
  phone_number_id  uuid        REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  name             text        NOT NULL,
  description      text,
  status           text        NOT NULL DEFAULT 'draft',  -- draft|active|paused|completed|cancelled
  targets          jsonb       NOT NULL DEFAULT '[]',     -- [{phone,name,metadata}]
  schedule_config  jsonb       DEFAULT '{}',              -- {start_time,end_time,timezone,days}
  retry_config     jsonb       DEFAULT '{"max_attempts":3,"retry_delay_minutes":60}',
  stats            jsonb       DEFAULT '{"total":0,"called":0,"answered":0,"booked":0,"failed":0}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members manage campaigns"
  ON public.campaigns FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

-- ── Telephony calls (provider-agnostic, separate from Retell calls table) ─────
CREATE TABLE IF NOT EXISTS public.telephony_calls (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_number_id  uuid        REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  agent_id         uuid        REFERENCES public.agents(id) ON DELETE SET NULL,
  campaign_id      uuid        REFERENCES public.campaigns(id) ON DELETE SET NULL,
  call_sid         text,                                  -- provider call ID
  direction        text        NOT NULL DEFAULT 'inbound',-- inbound|outbound
  from_number      text,
  to_number        text,
  status           text        NOT NULL DEFAULT 'initiated',
  -- initiated|ringing|answered|active|transferred|voicemail|completed|failed
  started_at       timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds integer,
  recording_url    text,
  recording_sid    text,
  recording_status text,                                  -- in-progress|completed|absent
  transcript       jsonb,                                 -- [{role,text,ts}]
  outcome          text,                                  -- booked|qualified|voicemail|callback|no_answer|failed|other
  cost_cents       integer,
  provider         text        NOT NULL DEFAULT 'twilio',
  metadata         jsonb       DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telephony_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members manage telephony_calls"
  ON public.telephony_calls FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

-- Public insert for webhook callbacks (status/recording updates from Twilio).
-- The service role key is used server-side so no anon policy is needed.

-- ── Call state events (audit log) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      uuid        NOT NULL REFERENCES public.telephony_calls(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type   text        NOT NULL,
  -- status_change|recording_started|recording_stopped|transcript_added|transfer|error
  event_data   jsonb       DEFAULT '{}',
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read call_events"
  ON public.call_events FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_telephony_calls_workspace ON public.telephony_calls(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_telephony_calls_sid ON public.telephony_calls(call_sid);
CREATE INDEX IF NOT EXISTS idx_telephony_calls_status ON public.telephony_calls(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_workspace ON public.phone_numbers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON public.campaigns(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_call ON public.call_events(call_id, occurred_at DESC);
