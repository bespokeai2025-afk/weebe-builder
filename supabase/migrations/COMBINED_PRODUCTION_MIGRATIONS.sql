-- ═══════════════════════════════════════════════════════════════════════════════
-- COMBINED PRODUCTION MIGRATIONS
-- Run this ONCE in your Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is
-- safe to re-run — it will only create what is missing and skip the rest.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. COST ENGINE (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cost_engine_llm (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  input_token_cost  DECIMAL(14,8) NOT NULL DEFAULT 0,
  output_token_cost DECIMAL(14,8) NOT NULL DEFAULT 0,
  audio_input_cost  DECIMAL(14,8) NOT NULL DEFAULT 0,
  audio_output_cost DECIMAL(14,8) NOT NULL DEFAULT 0,
  cached_token_cost DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_current       BOOLEAN NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_voice (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  voice_id          TEXT NOT NULL,
  voice_name        TEXT NOT NULL,
  cost_per_character DECIMAL(14,8) NOT NULL DEFAULT 0,
  cost_per_minute   DECIMAL(14,8) NOT NULL DEFAULT 0,
  cost_per_request  DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_current        BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_telephony (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL,
  country                 TEXT NOT NULL,
  inbound_cost_per_min    DECIMAL(14,8) NOT NULL DEFAULT 0,
  outbound_cost_per_min   DECIMAL(14,8) NOT NULL DEFAULT 0,
  recording_cost_per_min  DECIMAL(14,8) NOT NULL DEFAULT 0,
  number_rental_monthly   DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_current              BOOLEAN NOT NULL DEFAULT true,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_knowledge (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  embedding_cost_per_1k      DECIMAL(14,8) NOT NULL DEFAULT 0,
  vector_storage_per_gb_month DECIMAL(14,8) NOT NULL DEFAULT 0,
  retrieval_cost_per_query   DECIMAL(14,8) NOT NULL DEFAULT 0,
  storage_per_gb_month       DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_current                 BOOLEAN NOT NULL DEFAULT true,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_tools (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_cost_per_call DECIMAL(14,8) NOT NULL DEFAULT 0,
  api_cost_per_call     DECIMAL(14,8) NOT NULL DEFAULT 0,
  crm_cost_per_month    DECIMAL(14,8) NOT NULL DEFAULT 0,
  calendar_cost_per_month DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_current            BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_infrastructure (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_cost                DECIMAL(14,8) NOT NULL DEFAULT 0,
  database_cost              DECIMAL(14,8) NOT NULL DEFAULT 0,
  storage_cost               DECIMAL(14,8) NOT NULL DEFAULT 0,
  bandwidth_cost             DECIMAL(14,8) NOT NULL DEFAULT 0,
  allocation_type            TEXT NOT NULL DEFAULT 'monthly',
  estimated_monthly_minutes  DECIMAL(10,2) NOT NULL DEFAULT 1000,
  is_current                 BOOLEAN NOT NULL DEFAULT true,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_retell (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_cost_monthly DECIMAL(14,8) NOT NULL DEFAULT 0,
  minute_cost               DECIMAL(14,8) NOT NULL DEFAULT 0,
  number_cost_monthly       DECIMAL(14,8) NOT NULL DEFAULT 0,
  voice_cost_per_min        DECIMAL(14,8) NOT NULL DEFAULT 0,
  transfer_cost_per_min     DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_current                BOOLEAN NOT NULL DEFAULT true,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_markup (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL DEFAULT 'Default',
  markup_type  TEXT NOT NULL DEFAULT 'percentage',
  markup_value DECIMAL(14,8) NOT NULL DEFAULT 40,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_customer_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name        TEXT NOT NULL,
  description      TEXT,
  included_minutes INTEGER NOT NULL DEFAULT 0,
  price_per_month  DECIMAL(14,8) NOT NULL DEFAULT 0,
  price_per_minute DECIMAL(14,8) NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.call_profitability (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             TEXT,
  workspace_id        UUID,
  agent_id            UUID,
  provider            TEXT,
  model               TEXT,
  voice               TEXT,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  llm_cost_cents      INTEGER NOT NULL DEFAULT 0,
  voice_cost_cents    INTEGER NOT NULL DEFAULT 0,
  telephony_cost_cents INTEGER NOT NULL DEFAULT 0,
  infra_cost_cents    INTEGER NOT NULL DEFAULT 0,
  tool_cost_cents     INTEGER NOT NULL DEFAULT 0,
  total_cost_cents    INTEGER NOT NULL DEFAULT 0,
  selling_price_cents INTEGER NOT NULL DEFAULT 0,
  profit_cents        INTEGER NOT NULL DEFAULT 0,
  margin_pct          DECIMAL(8,4) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_profitability_workspace ON public.call_profitability(workspace_id);
CREATE INDEX IF NOT EXISTS idx_call_profitability_created  ON public.call_profitability(created_at DESC);
ALTER TABLE public.cost_engine_llm            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_voice          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_telephony      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_knowledge      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_tools          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_infrastructure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_retell         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_markup         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_customer_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_profitability         ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.cost_engine_llm            TO service_role;
GRANT ALL ON public.cost_engine_voice          TO service_role;
GRANT ALL ON public.cost_engine_telephony      TO service_role;
GRANT ALL ON public.cost_engine_knowledge      TO service_role;
GRANT ALL ON public.cost_engine_tools          TO service_role;
GRANT ALL ON public.cost_engine_infrastructure TO service_role;
GRANT ALL ON public.cost_engine_retell         TO service_role;
GRANT ALL ON public.cost_engine_markup         TO service_role;
GRANT ALL ON public.cost_engine_customer_plans TO service_role;
GRANT ALL ON public.call_profitability         TO service_role;

INSERT INTO public.cost_engine_llm (provider, model, input_token_cost, output_token_cost, audio_input_cost, audio_output_cost, cached_token_cost, notes) VALUES
  ('OpenAI', 'gpt-4o-realtime-preview', 0, 0, 0.10, 0.20, 0, 'Audio: $0.10/min in, $0.20/min out'),
  ('OpenAI', 'gpt-4.1', 0.002, 0.008, 0, 0, 0.001, '$0.002/1K in, $0.008/1K out'),
  ('OpenAI', 'gpt-4.1-mini', 0.0004, 0.0016, 0, 0, 0.0001, '$0.0004/1K in, $0.0016/1K out'),
  ('Anthropic', 'claude-sonnet-4-5', 0.003, 0.015, 0, 0, 0.003, '$0.003/1K in, $0.015/1K out'),
  ('Anthropic', 'claude-opus-4-5', 0.015, 0.075, 0, 0, 0.015, '$0.015/1K in, $0.075/1K out'),
  ('Google', 'gemini-2.0-flash', 0.000125, 0.000375, 0, 0, 0, '$0.000125/1K in, $0.000375/1K out'),
  ('Retell', 'retell-llm-dynamic-general', 0, 0, 0, 0, 0, 'Included in Retell per-minute rate')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_voice (provider, voice_id, voice_name, cost_per_character, cost_per_minute, cost_per_request, notes) VALUES
  ('OpenAI', 'alloy', 'Alloy', 0, 0, 0, 'Included in GPT-4o Realtime audio output cost'),
  ('OpenAI', 'nova',  'Nova',  0, 0, 0, 'Included in GPT-4o Realtime audio output cost'),
  ('ElevenLabs', 'eleven_turbo_v2', 'Turbo v2', 0.00018, 0, 0, '$0.18 per 1K chars'),
  ('ElevenLabs', 'eleven_monolingual_v1', 'Monolingual v1', 0.00030, 0, 0, '$0.30 per 1K chars'),
  ('Cartesia', 'sonic-english', 'Sonic English', 0.00085, 0, 0, '$0.85 per 1K chars'),
  ('Deepgram', 'aura-asteria-en', 'Aura Asteria', 0.00200, 0, 0, '$2.00 per 1K chars'),
  ('Retell', 'included', 'Retell Default', 0, 0, 0, 'Included in Retell per-minute rate')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_telephony (provider, country, inbound_cost_per_min, outbound_cost_per_min, recording_cost_per_min, number_rental_monthly, notes) VALUES
  ('Twilio', 'USA',       0.0085, 0.0140, 0.0025, 1.15, 'USD — approximate'),
  ('Twilio', 'UK',        0.0100, 0.0230, 0.0025, 1.15, 'USD — approximate'),
  ('Twilio', 'UAE',       0.0175, 0.0790, 0.0025, 2.00, 'USD — approximate'),
  ('Twilio', 'Canada',    0.0085, 0.0140, 0.0025, 1.15, 'USD — approximate'),
  ('Twilio', 'Australia', 0.0150, 0.0550, 0.0025, 1.75, 'USD — approximate'),
  ('FreJun', 'UAE',       0.0200, 0.0800, 0, 0, 'Estimated'),
  ('FreJun', 'India',     0.0050, 0.0100, 0, 0, 'Estimated')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_knowledge (embedding_cost_per_1k, vector_storage_per_gb_month, retrieval_cost_per_query, storage_per_gb_month, notes)
VALUES (0.00002, 0.095, 0.000001, 0.023, 'OpenAI text-embedding-3-small + Supabase pgvector approx')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_tools (webhook_cost_per_call, api_cost_per_call, crm_cost_per_month, calendar_cost_per_month, notes)
VALUES (0, 0, 0, 0, 'Update with actual integration costs')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_infrastructure (server_cost, database_cost, storage_cost, bandwidth_cost, allocation_type, estimated_monthly_minutes, notes)
VALUES (50, 25, 10, 5, 'monthly', 5000, 'Example monthly hosting costs in USD')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_retell (subscription_cost_monthly, minute_cost, number_cost_monthly, voice_cost_per_min, transfer_cost_per_min, notes)
VALUES (0, 0.05, 1.15, 0, 0.01, 'Retell $0.05/min')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_markup (label, markup_type, markup_value, notes)
VALUES ('Default', 'percentage', 40, '40% margin over cost')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_engine_customer_plans (plan_name, description, included_minutes, price_per_month, price_per_minute, sort_order) VALUES
  ('Starter',      'Entry-level plan',        200,  49,  0.25, 0),
  ('Professional', 'Growing businesses',      1000, 149, 0.20, 1),
  ('Business',     'High-volume operations',  5000, 499, 0.15, 2),
  ('Enterprise',   'Custom & unlimited',      0,    0,   0.12, 3)
ON CONFLICT DO NOTHING;

-- Cost Engine Onboarding
CREATE TABLE IF NOT EXISTS public.cost_engine_dev_roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name      TEXT NOT NULL,
  rate_per_hour  NUMERIC(10,2) NOT NULL DEFAULT 0,
  hours_per_week INT NOT NULL DEFAULT 40,
  notes          TEXT,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cost_engine_client_estimates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name           TEXT NOT NULL,
  client_email          TEXT,
  plan_id               UUID REFERENCES public.cost_engine_customer_plans(id) ON DELETE SET NULL,
  project_weeks         INT NOT NULL DEFAULT 4,
  team_config           JSONB NOT NULL DEFAULT '[]',
  monthly_addon_charges JSONB NOT NULL DEFAULT '[]',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cost_engine_dev_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_client_estimates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cost_engine_dev_roles (role_name, rate_per_hour, hours_per_week, sort_order) VALUES
  ('Junior Developer',    35.00, 40, 0),
  ('Mid-Level Developer', 65.00, 40, 1),
  ('Senior Developer',   100.00, 40, 2),
  ('QA Engineer',         45.00, 40, 3)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LEADS / PIPELINE (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sale_amount numeric;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. WHATSAPP CENTRE (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT,
  phone         TEXT NOT NULL,
  tags          TEXT[]   DEFAULT '{}',
  source        TEXT,
  lead_status   TEXT,
  notes         TEXT,
  archived      BOOLEAN  DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_contacts_ws_idx ON public.whatsapp_contacts(workspace_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  body          TEXT NOT NULL,
  variables     TEXT[]  DEFAULT '{}',
  category      TEXT    DEFAULT 'MARKETING',
  status        TEXT    DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_templates_ws_idx ON public.whatsapp_templates(workspace_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'broadcast',
  template_id     UUID REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  audience_filter JSONB   DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  status          TEXT    DEFAULT 'draft',
  stats           JSONB   DEFAULT '{"sent":0,"delivered":0,"read":0,"replied":0}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_campaigns_ws_idx ON public.whatsapp_campaigns(workspace_id);

ALTER TABLE public.whatsapp_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "wa_contacts_sel" ON public.whatsapp_contacts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_contacts_ins" ON public.whatsapp_contacts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_contacts_upd" ON public.whatsapp_contacts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_contacts_del" ON public.whatsapp_contacts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_tmpl_sel" ON public.whatsapp_templates FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_tmpl_ins" ON public.whatsapp_templates FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_tmpl_upd" ON public.whatsapp_templates FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_tmpl_del" ON public.whatsapp_templates FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_camp_sel" ON public.whatsapp_campaigns FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_camp_ins" ON public.whatsapp_campaigns FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_camp_upd" ON public.whatsapp_campaigns FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "wa_camp_del" ON public.whatsapp_campaigns FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_contacts  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_campaigns TO authenticated;
GRANT ALL ON public.whatsapp_contacts  TO service_role;
GRANT ALL ON public.whatsapp_templates TO service_role;
GRANT ALL ON public.whatsapp_campaigns TO service_role;

-- WhatsApp sessions
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_phone   TEXT NOT NULL,
  agent_id        UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  current_node_id TEXT,
  context         JSONB DEFAULT '{}',
  message_count   INT  DEFAULT 0,
  ended           BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, contact_phone)
);
CREATE INDEX IF NOT EXISTS wa_sessions_ws_idx    ON public.whatsapp_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS wa_sessions_phone_idx ON public.whatsapp_sessions(workspace_id, contact_phone);
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "wa_sessions_members" ON public.whatsapp_sessions
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_sessions TO authenticated;
GRANT ALL ON public.whatsapp_sessions TO service_role;

-- WA sessions workflow columns
ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS workflow_variables JSONB    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS waiting_for_reply  BOOLEAN  NOT NULL DEFAULT false;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CALLS PROVIDER + TELEPHONY LAYER (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS channel_type TEXT;

CREATE TABLE IF NOT EXISTS public.telephony_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'twilio',
  account_sid  text,
  auth_token   text,
  api_key      text,
  api_secret   text,
  is_active    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);
ALTER TABLE public.telephony_configs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members manage telephony_configs" ON public.telephony_configs FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telephony_config_id uuid REFERENCES public.telephony_configs(id) ON DELETE SET NULL,
  phone_number        text NOT NULL,
  friendly_name       text,
  provider            text NOT NULL DEFAULT 'twilio',
  provider_sid        text,
  agent_id            uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  capabilities        jsonb NOT NULL DEFAULT '{"voice":true,"sms":false}',
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members manage phone_numbers" ON public.phone_numbers FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  phone_number_id  uuid REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  name             text NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'draft',
  targets          jsonb NOT NULL DEFAULT '[]',
  schedule_config  jsonb DEFAULT '{}',
  retry_config     jsonb DEFAULT '{"max_attempts":3,"retry_delay_minutes":60}',
  stats            jsonb DEFAULT '{"total":0,"called":0,"answered":0,"booked":0,"failed":0}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members manage campaigns" ON public.campaigns FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.telephony_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_number_id  uuid REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  agent_id         uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  campaign_id      uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  call_sid         text,
  direction        text NOT NULL DEFAULT 'inbound',
  from_number      text,
  to_number        text,
  status           text NOT NULL DEFAULT 'initiated',
  started_at       timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds integer,
  recording_url    text,
  recording_sid    text,
  recording_status text,
  transcript       jsonb,
  outcome          text,
  cost_cents       integer,
  provider         text NOT NULL DEFAULT 'twilio',
  metadata         jsonb DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telephony_calls ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members manage telephony_calls" ON public.telephony_calls FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.call_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      uuid NOT NULL REFERENCES public.telephony_calls(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  event_data   jsonb DEFAULT '{}',
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members read call_events" ON public.call_events FOR SELECT
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_telephony_calls_workspace ON public.telephony_calls(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_telephony_calls_sid       ON public.telephony_calls(call_sid);
CREATE INDEX IF NOT EXISTS idx_telephony_calls_status    ON public.telephony_calls(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_workspace   ON public.phone_numbers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace       ON public.campaigns(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_call          ON public.call_events(call_id, occurred_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. WATI + META WA FIELDS (2026-06-14 / 2026-06-15)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wati_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null unique,
  api_key          text not null,
  tenant_id        text not null,
  webhook_secret   text,
  status           text not null default 'connected' check (status in ('connected','disconnected','error')),
  last_tested_at   timestamptz,
  error_message    text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
CREATE TABLE IF NOT EXISTS wati_templates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  wati_template_id text not null,
  name             text not null,
  status           text,
  language         text,
  category         text,
  components       jsonb,
  synced_at        timestamptz default now(),
  unique (workspace_id, wati_template_id)
);
CREATE TABLE IF NOT EXISTS wati_campaigns (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  wati_campaign_id text not null,
  name             text not null,
  status           text,
  template_name    text,
  broadcast_name   text,
  sent             int default 0,
  delivered        int default 0,
  read_count       int default 0,
  failed           int default 0,
  synced_at        timestamptz default now(),
  unique (workspace_id, wati_campaign_id)
);
CREATE TABLE IF NOT EXISTS wati_contacts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  wati_contact_id  text not null,
  phone            text not null,
  name             text,
  tags             text[],
  opted_in         boolean default false,
  synced_at        timestamptz default now(),
  unique (workspace_id, wati_contact_id)
);
CREATE TABLE IF NOT EXISTS wati_sync_logs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  sync_type        text not null check (sync_type in ('templates','campaigns','contacts','test')),
  status           text not null check (status in ('success','error')),
  records_synced   int default 0,
  error_message    text,
  created_at       timestamptz default now()
);
ALTER TABLE wati_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE wati_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wati_campaigns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wati_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wati_sync_logs   ENABLE ROW LEVEL SECURITY;

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id          TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token     TEXT,
  ADD COLUMN IF NOT EXISTS meta_verify_token     TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PRODUCTION WEBHOOK UPDATES AUDIT LOG (2026-06-15)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_webhook_updates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        REFERENCES workspace_settings(workspace_id) ON DELETE CASCADE,
  provider     text        NOT NULL,
  old_url      text,
  new_url      text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error        text,
  triggered_by text        DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prod_webhook_updates_workspace ON production_webhook_updates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_prod_webhook_updates_provider  ON production_webhook_updates(provider);
CREATE INDEX IF NOT EXISTS idx_prod_webhook_updates_created   ON production_webhook_updates(created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. WA CONTACTS DEDUP CONSTRAINT (2026-06-17)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.whatsapp_contacts
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, phone) id
  FROM public.whatsapp_contacts
  ORDER BY workspace_id, phone, created_at ASC
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_contacts_workspace_id_phone_key'
      AND conrelid = 'public.whatsapp_contacts'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_contacts
      ADD CONSTRAINT whatsapp_contacts_workspace_id_phone_key
      UNIQUE (workspace_id, phone);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. CONTACT DOCUMENTS (2026-06-18)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.data_records
  ADD COLUMN IF NOT EXISTS upload_token UUID DEFAULT gen_random_uuid() NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS data_records_upload_token_idx ON public.data_records(upload_token);
UPDATE public.data_records SET upload_token = gen_random_uuid() WHERE upload_token IS NULL;

CREATE TABLE IF NOT EXISTS public.contact_documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id    UUID        NOT NULL REFERENCES public.data_records(id) ON DELETE CASCADE,
  file_name     TEXT        NOT NULL,
  file_size     BIGINT,
  mime_type     TEXT,
  storage_path  TEXT        NOT NULL,
  public_url    TEXT        NOT NULL,
  uploaded_by   TEXT        NOT NULL DEFAULT 'client',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_docs_contact_idx ON public.contact_documents(contact_id);
CREATE INDEX IF NOT EXISTS contact_docs_ws_idx      ON public.contact_documents(workspace_id);
ALTER TABLE public.contact_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "contact_docs_sel" ON public.contact_documents FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "contact_docs_ins" ON public.contact_documents FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "contact_docs_del" ON public.contact_documents FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, DELETE ON public.contact_documents TO authenticated;
GRANT ALL ON public.contact_documents TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. CAMPAIGN EXECUTOR CRON (2026-06-19)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_config TO service_role;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role can manage app_config" ON public.app_config FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.trigger_campaign_executor()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_url TEXT; v_key TEXT;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'campaign_executor_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'campaign_executor_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[campaign-executor] URL or key not set — skipping';
    RETURN;
  END IF;
  PERFORM extensions.net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body    := '{}'::jsonb
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trigger_campaign_executor() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_campaign_executor() TO service_role;

SELECT cron.schedule('execute-call-campaigns','*/5 * * * *',$$SELECT public.trigger_campaign_executor()$$);


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. HEXMAIL (2026-06-20 / 2026-06-21)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hexmail_templates (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null,
  name         text        not null,
  type         text        not null,
  subject      text,
  content      text        not null default '',
  status       text        not null default 'active',
  usage_count  integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hexmail_templates_type_check
    check (type in ('email','sms','whatsapp','document','proposal','quote','invoice','contract')),
  constraint hexmail_templates_status_check
    check (status in ('active','archived'))
);
ALTER TABLE public.hexmail_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace members manage hexmail_templates" ON public.hexmail_templates;
CREATE POLICY "workspace members manage hexmail_templates" ON public.hexmail_templates FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.hexmail_campaigns (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null,
  name         text        not null,
  description  text,
  status       text        not null default 'draft',
  config       jsonb       not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hexmail_campaigns_status_check
    check (status in ('draft','active','paused','archived'))
);
ALTER TABLE public.hexmail_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace members manage hexmail_campaigns" ON public.hexmail_campaigns;
CREATE POLICY "workspace members manage hexmail_campaigns" ON public.hexmail_campaigns FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.hexmail_campaign_steps (
  id          uuid        primary key default gen_random_uuid(),
  campaign_id uuid        not null references public.hexmail_campaigns(id) on delete cascade,
  day_number  integer     not null,
  actions     jsonb       not null default '[]',
  created_at  timestamptz not null default now(),
  constraint hexmail_campaign_steps_day_unique unique(campaign_id, day_number)
);
ALTER TABLE public.hexmail_campaign_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace members manage hexmail_campaign_steps" ON public.hexmail_campaign_steps;
CREATE POLICY "workspace members manage hexmail_campaign_steps" ON public.hexmail_campaign_steps FOR ALL
  USING (campaign_id IN (
    SELECT id FROM public.hexmail_campaigns hc
    WHERE hc.workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  ));

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS hexmail_active_provider        TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_sendgrid_api_key       TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_sendgrid_from_email    TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_sendgrid_from_name     TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_resend_api_key         TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_resend_from_email      TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_resend_from_name       TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_postmark_server_token  TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_postmark_from_email    TEXT,
  ADD COLUMN IF NOT EXISTS hexmail_postmark_from_name     TEXT;

CREATE TABLE IF NOT EXISTS public.hexmail_campaign_enrollments (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  campaign_id    uuid not null references public.hexmail_campaigns(id) on delete cascade,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  enrolled_at    timestamptz not null default now(),
  status         text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  current_day    integer not null default 1,
  last_executed  timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
ALTER TABLE public.hexmail_campaign_enrollments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members can manage enrollments" ON public.hexmail_campaign_enrollments FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_hexmail_enrollments_ws_status ON public.hexmail_campaign_enrollments (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_hexmail_enrollments_campaign  ON public.hexmail_campaign_enrollments (campaign_id);
CREATE INDEX IF NOT EXISTS idx_hexmail_enrollments_lead      ON public.hexmail_campaign_enrollments (lead_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ 11. HIVEMIND PHASE 3 — TASKS + EVENTS (2026-06-22) ★★★
--     THIS IS THE TABLE CAUSING THE "INTERNAL ERROR"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hivemind_tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'suggested'
                           CHECK (status IN ('suggested','approved','in_progress','completed')),
  priority     TEXT        NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low','medium','high','critical')),
  assigned_to  TEXT,
  due_date     DATE,
  source       TEXT        NOT NULL DEFAULT 'ai_scan',
  trigger_type TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  comments     JSONB       NOT NULL DEFAULT '[]',
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hivemind_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL,
  event_type   TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info'
                           CHECK (severity IN ('info','warning','critical')),
  title        TEXT        NOT NULL,
  description  TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  task_id      UUID        REFERENCES hivemind_tasks(id) ON DELETE SET NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hivemind_tasks_ws_status  ON hivemind_tasks (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS hivemind_tasks_dedup       ON hivemind_tasks (workspace_id, trigger_type, entity_id) WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS hivemind_events_ws_unread  ON hivemind_events (workspace_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS hivemind_events_dedup      ON hivemind_events (workspace_id, event_type, entity_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ 12. HIVEMIND PHASE 4 — MODE + ACTIONS (2026-06-22) ★★★
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS hivemind_mode TEXT NOT NULL DEFAULT 'assistant'
  CHECK (hivemind_mode IN ('observe','recommend','assistant','operator'));

CREATE TABLE IF NOT EXISTS hivemind_actions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL,
  title          TEXT        NOT NULL,
  description    TEXT,
  action_type    TEXT        NOT NULL,
  action_payload JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','executed','failed')),
  proposed_by    TEXT        NOT NULL DEFAULT 'hivemind',
  approved_by    TEXT,
  result         JSONB,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS hivemind_actions_ws_status ON hivemind_actions (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS hivemind_actions_type       ON hivemind_actions (workspace_id, action_type, status);


-- ─────────────────────────────────────────────────────────────────────────────
-- 13. GROWTHMIND PHASE 1 (2026-06-24)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_recommendations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category       TEXT        NOT NULL,
  priority       TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  problem        TEXT        NOT NULL,
  impact         TEXT,
  fix            TEXT,
  action_href    TEXT,
  action_label   TEXT,
  is_dismissed   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','approved','in_progress','completed')),
  priority     TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  source       TEXT        NOT NULL DEFAULT 'ai_scan',
  trigger_type TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title        TEXT        NOT NULL,
  description  TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_name  TEXT,
  task_id      UUID        REFERENCES growthmind_tasks(id) ON DELETE SET NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS growthmind_recs_ws         ON growthmind_recommendations (workspace_id, is_dismissed, refreshed_at DESC);
CREATE INDEX IF NOT EXISTS growthmind_tasks_ws_status  ON growthmind_tasks (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS growthmind_tasks_dedup      ON growthmind_tasks (workspace_id, trigger_type, entity_id) WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS growthmind_events_ws_unread ON growthmind_events (workspace_id, is_read, created_at DESC);
ALTER TABLE growthmind_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_events          ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "growthmind_recs_select" ON growthmind_recommendations FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_recs_insert" ON growthmind_recommendations FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_recs_update" ON growthmind_recommendations FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_recs_delete" ON growthmind_recommendations FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_tasks_select" ON growthmind_tasks FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_tasks_insert" ON growthmind_tasks FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_tasks_update" ON growthmind_tasks FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_tasks_delete" ON growthmind_tasks FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_events_select" ON growthmind_events FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_events_insert" ON growthmind_events FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_events_update" ON growthmind_events FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "growthmind_events_delete" ON growthmind_events FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 14. GROWTHMIND PHASE 2 — ADS, FUNNELS, PLAYBOOKS, SEO, COMPETITORS (2026-06-25)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_ads_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL CHECK (platform IN ('google','meta','linkedin','tiktok')),
  label          TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  token_enc      TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','disconnected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ads_account_id  UUID REFERENCES growthmind_ads_accounts(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('google','meta','linkedin','tiktok')),
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  spend           NUMERIC NOT NULL DEFAULT 0,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  conversions     BIGINT NOT NULL DEFAULT 0,
  cpl             NUMERIC GENERATED ALWAYS AS (CASE WHEN conversions > 0 THEN spend / conversions ELSE NULL END) STORED,
  roas            NUMERIC,
  period_start    DATE,
  period_end      DATE,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_playbooks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  industry     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_funnels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'Funnel Snapshot',
  stages       JSONB NOT NULL DEFAULT '[]',
  snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_forecasts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scenario     TEXT NOT NULL DEFAULT 'base' CHECK (scenario IN ('conservative','base','optimistic')),
  period_weeks INTEGER NOT NULL DEFAULT 12,
  deal_value   NUMERIC NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  buckets      JSONB NOT NULL DEFAULT '[]',
  summary      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_competitors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  website        TEXT NOT NULL DEFAULT '',
  services       TEXT NOT NULL DEFAULT '',
  offers         TEXT NOT NULL DEFAULT '',
  positioning    TEXT NOT NULL DEFAULT '',
  observations   TEXT NOT NULL DEFAULT '',
  ai_analysis    TEXT,
  ai_analysed_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growthmind_seo_sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  keywords      JSONB NOT NULL DEFAULT '[]',
  content_ideas JSONB NOT NULL DEFAULT '[]',
  ai_recs       JSONB NOT NULL DEFAULT '[]',
  ai_rec_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_ads_accounts_ws ON growthmind_ads_accounts (workspace_id, platform);
CREATE INDEX IF NOT EXISTS gm_campaigns_ws    ON growthmind_campaigns    (workspace_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_playbooks_ws    ON growthmind_playbooks    (workspace_id, status, activated_at DESC);
CREATE INDEX IF NOT EXISTS gm_funnels_ws      ON growthmind_funnels      (workspace_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS gm_forecasts_ws    ON growthmind_forecasts    (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_competitors_ws  ON growthmind_competitors  (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_seo_sites_ws    ON growthmind_seo_sites    (workspace_id);
ALTER TABLE growthmind_ads_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_playbooks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_funnels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_forecasts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_competitors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_seo_sites    ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_ads_accounts_select" ON growthmind_ads_accounts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_ads_accounts_insert" ON growthmind_ads_accounts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_ads_accounts_update" ON growthmind_ads_accounts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_ads_accounts_delete" ON growthmind_ads_accounts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_campaigns_select" ON growthmind_campaigns FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_campaigns_insert" ON growthmind_campaigns FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_campaigns_update" ON growthmind_campaigns FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_campaigns_delete" ON growthmind_campaigns FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_playbooks_select" ON growthmind_playbooks FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_playbooks_insert" ON growthmind_playbooks FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_playbooks_update" ON growthmind_playbooks FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_playbooks_delete" ON growthmind_playbooks FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_funnels_select" ON growthmind_funnels FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_funnels_insert" ON growthmind_funnels FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_funnels_update" ON growthmind_funnels FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_funnels_delete" ON growthmind_funnels FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_forecasts_select" ON growthmind_forecasts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_forecasts_insert" ON growthmind_forecasts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_forecasts_update" ON growthmind_forecasts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_forecasts_delete" ON growthmind_forecasts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_competitors_select" ON growthmind_competitors FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_competitors_insert" ON growthmind_competitors FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_competitors_update" ON growthmind_competitors FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_competitors_delete" ON growthmind_competitors FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_seo_sites_select" ON growthmind_seo_sites FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_seo_sites_insert" ON growthmind_seo_sites FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_seo_sites_update" ON growthmind_seo_sites FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_seo_sites_delete" ON growthmind_seo_sites FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- GrowthMind settings column + playbook unique constraint
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS growthmind_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Deduplicate playbooks before adding unique constraint
DELETE FROM growthmind_playbooks
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, industry) id
  FROM growthmind_playbooks
  ORDER BY workspace_id, industry, activated_at DESC, created_at DESC
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_growthmind_playbooks_workspace_industry'
  ) THEN
    ALTER TABLE growthmind_playbooks
      ADD CONSTRAINT uq_growthmind_playbooks_workspace_industry
      UNIQUE (workspace_id, industry);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 15. GROWTHMIND GOALS (2026-06-29)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL CHECK (metric IN ('leads','bookings','sales','call_success_rate','calls_made')),
  label        TEXT NOT NULL,
  target       NUMERIC NOT NULL CHECK (target > 0),
  deadline     DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_goals_workspace_idx ON growthmind_goals (workspace_id, created_at DESC);
ALTER TABLE growthmind_goals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "gm_goals_select" ON growthmind_goals FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_goals_insert" ON growthmind_goals FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_goals_update" ON growthmind_goals FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "gm_goals_delete" ON growthmind_goals FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 16. GROWTHMIND CONTENT STUDIO (2026-06-29)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_content_folders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  icon         text not null default 'folder',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
ALTER TABLE growthmind_content_folders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "workspace members can manage content folders" ON growthmind_content_folders FOR ALL USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS growthmind_content_assets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  folder_id      uuid references growthmind_content_folders(id) on delete set null,
  title          text not null check (length(trim(title)) > 0),
  content_type   text not null,
  content        text not null default '',
  brief          jsonb not null default '{}',
  seo_data       jsonb not null default '{}',
  status         text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_favourite   boolean not null default false,
  scheduled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
ALTER TABLE growthmind_content_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "workspace members can manage content assets" ON growthmind_content_assets FOR ALL USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_growthmind_content_assets_workspace ON growthmind_content_assets(workspace_id, created_at desc);
CREATE INDEX IF NOT EXISTS idx_growthmind_content_assets_folder    ON growthmind_content_assets(folder_id) WHERE folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS growthmind_content_templates (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  content_type   text not null,
  brief_defaults jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
ALTER TABLE growthmind_content_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "workspace members can manage content templates" ON growthmind_content_templates FOR ALL USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS growthmind_content_generations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id     uuid references growthmind_content_assets(id) on delete set null,
  content_type text not null,
  brief        jsonb not null default '{}',
  tokens_used  int,
  created_at   timestamptz not null default now()
);
ALTER TABLE growthmind_content_generations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "workspace members can view content generations" ON growthmind_content_generations FOR ALL USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS growthmind_content_campaign_links (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  asset_id      uuid not null references growthmind_content_assets(id) on delete cascade,
  campaign_type text not null,
  campaign_id   text not null,
  created_at    timestamptz not null default now()
);
ALTER TABLE growthmind_content_campaign_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "workspace members can manage campaign links" ON growthmind_content_campaign_links FOR ALL USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 17. GROWTHMIND MODEL ROUTING (2026-06-29)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_model_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL DEFAULT 'smart' CHECK (mode IN ('smart', 'manual')),
  provider     TEXT,
  model        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE growthmind_model_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members can manage model settings" ON growthmind_model_settings FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS growthmind_generation_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id            UUID REFERENCES growthmind_content_assets(id) ON DELETE SET NULL,
  task_type           TEXT NOT NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  estimated_cost_usd  NUMERIC(10, 6),
  status              TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'fallback')),
  fallback_from       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gm_gen_logs_workspace ON growthmind_generation_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_gen_logs_asset     ON growthmind_generation_logs(asset_id);
ALTER TABLE growthmind_generation_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members can manage generation logs" ON growthmind_generation_logs FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 18. GSC COLUMNS (2026-07-01 / 2026-07-02)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS gsc_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS gsc_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gsc_token_expiry  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gsc_property_url  TEXT,
  ADD COLUMN IF NOT EXISTS gsc_auto_matched  BOOLEAN DEFAULT FALSE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 19. GROWTHMIND CONTENT CALENDAR + GROWTH SCHEDULER (2026-07-03)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_growth_campaigns (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  campaign_type  text not null default 'Brand Awareness',
  description    text default '',
  start_date     date,
  end_date       date,
  budget         numeric(12,2),
  status         text not null default 'active',
  color          text default '#10b981',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS growthmind_content_series (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  description    text default '',
  content_type   text not null default 'Blog',
  cadence        text not null default 'weekly',
  day_of_week    integer default 1,
  channel        text default '',
  is_active      boolean not null default true,
  next_date      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS growthmind_content_calendar (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  title          text not null,
  content_type   text not null default 'Blog',
  channel        text default '',
  status         text not null default 'Draft',
  campaign_id    uuid references growthmind_growth_campaigns(id) on delete set null,
  series_id      uuid references growthmind_content_series(id) on delete set null,
  owner          text default '',
  scheduled_date timestamptz,
  description    text default '',
  notes          text default '',
  plan_id        uuid,
  sort_order     integer default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS growthmind_scheduled_content (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  calendar_entry_id   uuid references growthmind_content_calendar(id) on delete set null,
  title               text not null,
  content_type        text not null default 'Blog',
  channel             text default '',
  published_date      timestamptz,
  external_url        text default '',
  platform_post_id    text default '',
  reach               integer default 0,
  impressions         integer default 0,
  clicks              integer default 0,
  leads_generated     integer default 0,
  notes               text default '',
  created_at          timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS growthmind_marketing_tasks (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  title               text not null,
  description         text default '',
  task_type           text not null default 'General',
  status              text not null default 'pending',
  priority            text not null default 'medium',
  due_date            date,
  completed_at        timestamptz,
  calendar_entry_id   uuid references growthmind_content_calendar(id) on delete set null,
  campaign_id         uuid references growthmind_growth_campaigns(id) on delete set null,
  plan_id             uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
CREATE TABLE IF NOT EXISTS growthmind_growth_plans (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  name                  text not null,
  plan_type             text not null default '90_day',
  status                text not null default 'draft',
  business_type         text default '',
  industry              text default '',
  target_audience       text default '',
  offer                 text default '',
  monthly_budget        numeric(12,2),
  target_markets        text default '',
  keywords              text[] default '{}',
  growth_goals          text default '',
  target_leads_per_month integer default 0,
  generated_summary     text default '',
  generated_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS growthmind_calendar_workspace_date   ON growthmind_content_calendar(workspace_id, scheduled_date);
CREATE INDEX IF NOT EXISTS growthmind_calendar_workspace_status ON growthmind_content_calendar(workspace_id, status);
CREATE INDEX IF NOT EXISTS growthmind_marketing_tasks_ws_status ON growthmind_marketing_tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS growthmind_marketing_tasks_ws_due    ON growthmind_marketing_tasks(workspace_id, due_date);
ALTER TABLE growthmind_growth_campaigns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_content_series    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_content_calendar  ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_scheduled_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_marketing_tasks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_growth_plans      ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "workspace_isolation" ON growthmind_growth_campaigns  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "workspace_isolation" ON growthmind_content_series    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "workspace_isolation" ON growthmind_content_calendar  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "workspace_isolation" ON growthmind_scheduled_content USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "workspace_isolation" ON growthmind_marketing_tasks   USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "workspace_isolation" ON growthmind_growth_plans      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 20. GROWTHMIND VIDEO ASSETS (2026-07-04)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_video_assets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  title          text not null,
  video_type     text not null,
  provider       text,
  script         text not null default '',
  storyboard     jsonb not null default '[]',
  video_url      text,
  audio_url      text,
  voice_id       text,
  quality_mode   text not null default 'fast',
  cost_estimate  numeric(10,6) not null default 0,
  scheduled_at   date,
  created_at     timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS growthmind_video_assets_workspace_idx ON growthmind_video_assets(workspace_id, created_at desc);
CREATE INDEX IF NOT EXISTS growthmind_video_assets_type_idx      ON growthmind_video_assets(workspace_id, video_type);
ALTER TABLE growthmind_video_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members can manage video assets" ON growthmind_video_assets FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 21. UNIVERSAL PROVIDER FRAMEWORK (2026-07-05)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_category TEXT NOT NULL,
  provider_name     TEXT NOT NULL,
  credentials       JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error','coming_soon')),
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  is_fallback       BOOLEAN NOT NULL DEFAULT FALSE,
  priority          INTEGER NOT NULL DEFAULT 99,
  last_sync         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider_category, provider_name)
);
CREATE INDEX IF NOT EXISTS provider_settings_workspace_idx ON provider_settings (workspace_id);
CREATE INDEX IF NOT EXISTS provider_settings_category_idx  ON provider_settings (workspace_id, provider_category);
ALTER TABLE provider_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace_members_provider_settings" ON provider_settings FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS provider_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_category TEXT NOT NULL,
  provider_name     TEXT NOT NULL,
  requests          BIGINT NOT NULL DEFAULT 0,
  errors            BIGINT NOT NULL DEFAULT 0,
  total_cost_usd    NUMERIC(14,6) NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider_category, provider_name)
);
CREATE INDEX IF NOT EXISTS provider_usage_workspace_idx ON provider_usage (workspace_id);
CREATE INDEX IF NOT EXISTS provider_usage_cost_idx      ON provider_usage (workspace_id, total_cost_usd DESC);
ALTER TABLE provider_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace_members_provider_usage" ON provider_usage FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 22. EXECUTIVE EVENTS (2026-07-06)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executive_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'hivemind' CHECK (source IN ('hivemind','growthmind')),
  event_type   TEXT NOT NULL,
  summary      TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS executive_events_ws_recent ON executive_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS executive_events_dedup     ON executive_events (workspace_id, source, event_type, created_at DESC);
ALTER TABLE executive_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "executive_events_select" ON executive_events FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "executive_events_insert" ON executive_events FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "executive_events_update" ON executive_events FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "executive_events_delete" ON executive_events FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 23. EXECUTIVE KNOWLEDGE SYSTEM (2026-07-07)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.executive_knowledge_bases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  mind_type     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  is_shared     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS exec_kb_ws_idx ON public.executive_knowledge_bases(workspace_id);

CREATE TABLE IF NOT EXISTS public.executive_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES public.executive_knowledge_bases(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL DEFAULT 'upload',
  title             TEXT NOT NULL,
  file_name         TEXT,
  mime_type         TEXT,
  file_size         BIGINT,
  storage_path      TEXT,
  content_hash      TEXT,
  seed_key          TEXT,
  chunk_count       INTEGER NOT NULL DEFAULT 0,
  embedding_status  TEXT NOT NULL DEFAULT 'pending',
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  indexed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS exec_docs_ws_idx     ON public.executive_documents(workspace_id);
CREATE INDEX IF NOT EXISTS exec_docs_kb_idx     ON public.executive_documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS exec_docs_status_idx ON public.executive_documents(embedding_status);
CREATE UNIQUE INDEX IF NOT EXISTS exec_docs_seed_key_idx ON public.executive_documents(workspace_id, seed_key) WHERE seed_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.executive_document_chunks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id       UUID NOT NULL REFERENCES public.executive_documents(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES public.executive_knowledge_bases(id) ON DELETE CASCADE,
  chunk_index       INTEGER NOT NULL DEFAULT 0,
  content           TEXT NOT NULL,
  token_count       INTEGER NOT NULL DEFAULT 0,
  embedding_vector  vector(1536),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exec_chunks_ws_idx        ON public.executive_document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS exec_chunks_doc_idx       ON public.executive_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS exec_chunks_kb_idx        ON public.executive_document_chunks(knowledge_base_id);
CREATE INDEX IF NOT EXISTS exec_chunks_embedding_idx ON public.executive_document_chunks
  USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS public.executive_knowledge_queries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mind_type        TEXT NOT NULL,
  query            TEXT NOT NULL,
  top_k            INTEGER NOT NULL DEFAULT 5,
  matched_count    INTEGER NOT NULL DEFAULT 0,
  matched_kb_slugs TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exec_queries_ws_idx   ON public.executive_knowledge_queries(workspace_id);
CREATE INDEX IF NOT EXISTS exec_queries_mind_idx ON public.executive_knowledge_queries(mind_type);
CREATE INDEX IF NOT EXISTS exec_queries_time_idx ON public.executive_knowledge_queries(created_at);

CREATE OR REPLACE FUNCTION public.match_executive_document_chunks(
  p_workspace_id    UUID,
  p_knowledge_base_ids UUID[],
  p_query_embedding vector(1536),
  p_match_count     INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id UUID, document_id UUID, knowledge_base_id UUID,
  content TEXT, metadata JSONB, similarity FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.document_id, c.knowledge_base_id, c.content, c.metadata,
         1 - (c.embedding_vector <=> p_query_embedding) AS similarity
  FROM public.executive_document_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND c.knowledge_base_id = ANY(p_knowledge_base_ids)
    AND c.embedding_vector IS NOT NULL
  ORDER BY c.embedding_vector <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$$;

ALTER TABLE public.executive_knowledge_bases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_document_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_knowledge_queries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "exec_kb_sel"     ON public.executive_knowledge_bases   FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_kb_ins"     ON public.executive_knowledge_bases   FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_kb_upd"     ON public.executive_knowledge_bases   FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_kb_del"     ON public.executive_knowledge_bases   FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_docs_sel"   ON public.executive_documents         FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_docs_ins"   ON public.executive_documents         FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_docs_upd"   ON public.executive_documents         FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_docs_del"   ON public.executive_documents         FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_chunks_sel" ON public.executive_document_chunks   FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_chunks_ins" ON public.executive_document_chunks   FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_chunks_del" ON public.executive_document_chunks   FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_queries_sel" ON public.executive_knowledge_queries FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "exec_queries_ins" ON public.executive_knowledge_queries FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_knowledge_bases   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_documents         TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.executive_document_chunks   TO authenticated;
GRANT SELECT, INSERT                 ON public.executive_knowledge_queries TO authenticated;
GRANT ALL ON public.executive_knowledge_bases   TO service_role;
GRANT ALL ON public.executive_documents         TO service_role;
GRANT ALL ON public.executive_document_chunks   TO service_role;
GRANT ALL ON public.executive_knowledge_queries TO service_role;

REVOKE EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 24. SYSTEMMIND WORKFLOW LIBRARY (2026-07-08)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_workflow_library (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id        UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  workflow_name   TEXT NOT NULL,
  agent_type      TEXT,
  category        TEXT,
  channel         TEXT,
  provider        TEXT,
  node_count      INTEGER NOT NULL DEFAULT 0,
  edge_count      INTEGER NOT NULL DEFAULT 0,
  node_types      TEXT[] NOT NULL DEFAULT '{}',
  tool_ids        TEXT[] NOT NULL DEFAULT '{}',
  has_webhook     BOOLEAN NOT NULL DEFAULT FALSE,
  has_booking     BOOLEAN NOT NULL DEFAULT FALSE,
  has_transfer    BOOLEAN NOT NULL DEFAULT FALSE,
  has_knowledge_base BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS public.systemmind_workflow_patterns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category             TEXT NOT NULL,
  pattern_name         TEXT NOT NULL,
  description          TEXT,
  node_sequence        TEXT[] NOT NULL DEFAULT '{}',
  common_tools         TEXT[] NOT NULL DEFAULT '{}',
  common_variables     TEXT[] NOT NULL DEFAULT '{}',
  logic_split_pattern  TEXT,
  booking_pattern      TEXT,
  transfer_pattern     TEXT,
  document_pattern     TEXT,
  example_workflow_ids UUID[] NOT NULL DEFAULT '{}',
  confidence_score     NUMERIC NOT NULL DEFAULT 0,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, category, pattern_name)
);
CREATE INDEX IF NOT EXISTS sm_wp_ws_idx ON public.systemmind_workflow_patterns(workspace_id);

CREATE TABLE IF NOT EXISTS public.systemmind_repair_playbooks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  playbook_key   TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'repair',
  problem        TEXT NOT NULL,
  symptoms       TEXT[] NOT NULL DEFAULT '{}',
  checks         TEXT[] NOT NULL DEFAULT '{}',
  fix_steps      TEXT[] NOT NULL DEFAULT '{}',
  affected_files TEXT[] NOT NULL DEFAULT '{}',
  risk_level     TEXT NOT NULL DEFAULT 'medium',
  rollback_plan  TEXT,
  provider       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, playbook_key)
);
CREATE INDEX IF NOT EXISTS sm_pb_ws_idx   ON public.systemmind_repair_playbooks(workspace_id);
CREATE INDEX IF NOT EXISTS sm_pb_risk_idx ON public.systemmind_repair_playbooks(risk_level);
CREATE INDEX IF NOT EXISTS sm_pb_cat_idx  ON public.systemmind_repair_playbooks(category);

CREATE TABLE IF NOT EXISTS public.systemmind_workflow_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  category             TEXT,
  status               TEXT NOT NULL DEFAULT 'draft',
  nodes                JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges                JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables            JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools                JSONB NOT NULL DEFAULT '[]'::jsonb,
  webhook_suggestions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  kb_suggestions       TEXT[] NOT NULL DEFAULT '{}',
  follow_up_suggestions TEXT[] NOT NULL DEFAULT '{}',
  generated_by         TEXT NOT NULL DEFAULT 'systemmind',
  source_patterns      UUID[] NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sm_wd_ws_idx ON public.systemmind_workflow_drafts(workspace_id);

ALTER TABLE public.systemmind_workflow_library  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_workflow_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_repair_playbooks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_workflow_drafts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_wl_sel" ON public.systemmind_workflow_library; CREATE POLICY "sm_wl_sel" ON public.systemmind_workflow_library FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wl_ins" ON public.systemmind_workflow_library; CREATE POLICY "sm_wl_ins" ON public.systemmind_workflow_library FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wl_upd" ON public.systemmind_workflow_library; CREATE POLICY "sm_wl_upd" ON public.systemmind_workflow_library FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wl_del" ON public.systemmind_workflow_library; CREATE POLICY "sm_wl_del" ON public.systemmind_workflow_library FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wp_sel" ON public.systemmind_workflow_patterns; CREATE POLICY "sm_wp_sel" ON public.systemmind_workflow_patterns FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wp_ins" ON public.systemmind_workflow_patterns; CREATE POLICY "sm_wp_ins" ON public.systemmind_workflow_patterns FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wp_upd" ON public.systemmind_workflow_patterns; CREATE POLICY "sm_wp_upd" ON public.systemmind_workflow_patterns FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wp_del" ON public.systemmind_workflow_patterns; CREATE POLICY "sm_wp_del" ON public.systemmind_workflow_patterns FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_pb_sel" ON public.systemmind_repair_playbooks; CREATE POLICY "sm_pb_sel" ON public.systemmind_repair_playbooks FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_pb_ins" ON public.systemmind_repair_playbooks; CREATE POLICY "sm_pb_ins" ON public.systemmind_repair_playbooks FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_pb_upd" ON public.systemmind_repair_playbooks; CREATE POLICY "sm_pb_upd" ON public.systemmind_repair_playbooks FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_pb_del" ON public.systemmind_repair_playbooks; CREATE POLICY "sm_pb_del" ON public.systemmind_repair_playbooks FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wd_sel" ON public.systemmind_workflow_drafts; CREATE POLICY "sm_wd_sel" ON public.systemmind_workflow_drafts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wd_ins" ON public.systemmind_workflow_drafts; CREATE POLICY "sm_wd_ins" ON public.systemmind_workflow_drafts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "sm_wd_del" ON public.systemmind_workflow_drafts; CREATE POLICY "sm_wd_del" ON public.systemmind_workflow_drafts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_workflow_library  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_workflow_patterns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_repair_playbooks  TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.systemmind_workflow_drafts   TO authenticated;
GRANT ALL ON public.systemmind_workflow_library  TO service_role;
GRANT ALL ON public.systemmind_workflow_patterns TO service_role;
GRANT ALL ON public.systemmind_repair_playbooks  TO service_role;
GRANT ALL ON public.systemmind_workflow_drafts   TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 25. SYSTEMMIND CTO MODULE (2026-07-15)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.systemmind_recommendations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  priority     text NOT NULL DEFAULT 'medium',
  category     text NOT NULL DEFAULT 'general',
  title        text NOT NULL,
  body         text,
  source       text DEFAULT 'ai',
  dismissed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_rec_ws_idx ON public.systemmind_recommendations (workspace_id, created_at desc);

CREATE TABLE IF NOT EXISTS public.systemmind_audits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  triggered_by text NOT NULL DEFAULT 'manual',
  status       text NOT NULL DEFAULT 'running',
  score        integer,
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sm_aud_ws_idx ON public.systemmind_audits (workspace_id, created_at desc);

CREATE TABLE IF NOT EXISTS public.systemmind_fix_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_type  text,
  source_id    text,
  title        text NOT NULL,
  detail       text,
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status       text NOT NULL DEFAULT 'open',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_fp_ws_idx ON public.systemmind_fix_plans (workspace_id, created_at desc);

CREATE TABLE IF NOT EXISTS public.systemmind_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'open',
  priority     text NOT NULL DEFAULT 'medium',
  due_at       timestamptz,
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_task_ws_idx ON public.systemmind_tasks (workspace_id, status);

CREATE TABLE IF NOT EXISTS public.systemmind_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text NOT NULL,
  model        text NOT NULL DEFAULT 'gpt-4o-mini',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_rep_ws_idx ON public.systemmind_reports (workspace_id, created_at desc);

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS systemmind_cto_settings jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.systemmind_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_audits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_fix_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemmind_reports         ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "sm_rec_sel" ON public.systemmind_recommendations FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_rec_ins" ON public.systemmind_recommendations FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_rec_upd" ON public.systemmind_recommendations FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_rec_del" ON public.systemmind_recommendations FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_aud_sel" ON public.systemmind_audits FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_aud_ins" ON public.systemmind_audits FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_aud_upd" ON public.systemmind_audits FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_aud_del" ON public.systemmind_audits FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_fp_sel"  ON public.systemmind_fix_plans FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_fp_ins"  ON public.systemmind_fix_plans FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_fp_upd"  ON public.systemmind_fix_plans FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_fp_del"  ON public.systemmind_fix_plans FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_task_sel" ON public.systemmind_tasks FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_task_ins" ON public.systemmind_tasks FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_task_upd" ON public.systemmind_tasks FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_task_del" ON public.systemmind_tasks FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_rep_sel" ON public.systemmind_reports FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_rep_ins" ON public.systemmind_reports FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sm_rep_del" ON public.systemmind_reports FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_recommendations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_audits          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_fix_plans       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.systemmind_tasks           TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.systemmind_reports         TO authenticated;
GRANT ALL ON public.systemmind_recommendations TO service_role;
GRANT ALL ON public.systemmind_audits          TO service_role;
GRANT ALL ON public.systemmind_fix_plans       TO service_role;
GRANT ALL ON public.systemmind_tasks           TO service_role;
GRANT ALL ON public.systemmind_reports         TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 26. PROVIDER COST EXTENSION (2026-07-20)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE provider_usage
  ADD COLUMN IF NOT EXISTS units_consumed    NUMERIC(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_type         TEXT,
  ADD COLUMN IF NOT EXISTS cost_per_unit_usd NUMERIC(18,8) DEFAULT 0;

CREATE TABLE IF NOT EXISTS provider_cost_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_category TEXT NOT NULL,
  provider_name   TEXT NOT NULL,
  unit_type       TEXT NOT NULL,
  cost_per_unit_usd NUMERIC(18,8) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider_category, provider_name, unit_type)
);
ALTER TABLE provider_cost_rates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members can read cost rates" ON provider_cost_rates FOR SELECT
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "workspace admins can manage cost rates" ON provider_cost_rates FOR ALL
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO provider_cost_rates (workspace_id, provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
SELECT w.id, r.provider_category, r.provider_name, r.unit_type, r.cost_per_unit_usd, r.notes
FROM workspaces w
CROSS JOIN (VALUES
  ('email',       'resend',           'email',         0.0008,  'Resend: $0.80 per 1K emails'),
  ('email',       'sendgrid',         'email',         0.0006,  'SendGrid Essentials'),
  ('image',       'gpt_image',        'image',         0.04,    'DALL-E 3 standard'),
  ('image',       'imagen',           'image',         0.02,    'Imagen 3 est.'),
  ('video',       'runway',           'video_seconds', 0.05,    'Runway Gen3'),
  ('video',       'google_veo',       'video_seconds', 0.06,    'Google Veo est.'),
  ('whatsapp',    'wati',             'whatsapp',      0.005,   'WATI ~$0.005/msg'),
  ('whatsapp',    'meta',             'whatsapp',      0.0035,  'Meta ~$0.0035/msg'),
  ('analytics',   'google_analytics', 'api_call',      0.0,     'GA4 free tier'),
  ('advertising', 'google_ads',       'sync',          0.0,     'Google Ads free'),
  ('advertising', 'meta_ads',         'sync',          0.0,     'Meta API free'),
  ('crm',         'hubspot',          'api_call',      0.0,     'HubSpot free tier'),
  ('crm',         'gohighlevel',      'api_call',      0.0,     'GHL subscription'),
  ('calendar',    'calcom',           'api_call',      0.0,     'Cal.com free tier'),
  ('calendar',    'google',           'api_call',      0.0,     'Google Calendar free')
) AS r(provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
ON CONFLICT (workspace_id, provider_category, provider_name, unit_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS provider_credential_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  provider_category TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('save','delete','test_ok','test_fail')),
  latency_ms    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE provider_credential_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace admins can read audit log" ON provider_credential_audit FOR SELECT
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 27. PROVIDER USAGE LOG (2026-07-21)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_usage_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_category TEXT NOT NULL,
  provider_name     TEXT NOT NULL,
  requests          INT NOT NULL DEFAULT 1,
  errors            INT NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(18,6) NOT NULL DEFAULT 0,
  duration_ms       INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_usage_log_ws_ts
  ON provider_usage_log (workspace_id, provider_category, provider_name, created_at DESC);
ALTER TABLE provider_usage_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members can read usage log" ON provider_usage_log FOR SELECT
    USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- ADS SYNC CRON (20260722)
-- Schedules a 15-minute pg_cron job that POSTs to /api/public/ads-sync to keep
-- ad campaign metrics fresh. After running this block, also run the separate
-- APPLY_ADS_SYNC_CONFIG.sql snippet to insert the two app_config rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.app_config TO service_role;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage app_config"
    ON public.app_config FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_ads_sync()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.app_config WHERE key = 'ads_sync_url';
  SELECT value INTO v_secret FROM public.app_config WHERE key = 'ads_sync_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE '[ads-sync] ads_sync_url or ads_sync_secret not set in app_config — skipping';
    RETURN;
  END IF;

  PERFORM extensions.net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  v_secret
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_ads_sync() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.trigger_ads_sync() TO service_role;

SELECT cron.schedule(
  'sync-ads-analytics',
  '*/15 * * * *',
  $$SELECT public.trigger_ads_sync()$$
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF COMBINED MIGRATIONS
-- ═══════════════════════════════════════════════════════════════════════════════
