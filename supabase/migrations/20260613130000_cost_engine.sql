-- ── Cost Engine Tables ─────────────────────────────────────────────────────────
-- Platform-wide pricing data. No workspace_id — admin only, service role access.

-- LLM / Model costs
CREATE TABLE IF NOT EXISTS public.cost_engine_llm (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  input_token_cost  DECIMAL(14,8) NOT NULL DEFAULT 0, -- per 1K tokens
  output_token_cost DECIMAL(14,8) NOT NULL DEFAULT 0, -- per 1K tokens
  audio_input_cost  DECIMAL(14,8) NOT NULL DEFAULT 0, -- per minute
  audio_output_cost DECIMAL(14,8) NOT NULL DEFAULT 0, -- per minute
  cached_token_cost DECIMAL(14,8) NOT NULL DEFAULT 0, -- per 1K tokens
  is_current       BOOLEAN NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Voice costs
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

-- Telephony costs
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

-- Knowledge base costs (singleton — one active row)
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

-- Tool costs (singleton)
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

-- Infrastructure costs (singleton)
CREATE TABLE IF NOT EXISTS public.cost_engine_infrastructure (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_cost                DECIMAL(14,8) NOT NULL DEFAULT 0,
  database_cost              DECIMAL(14,8) NOT NULL DEFAULT 0,
  storage_cost               DECIMAL(14,8) NOT NULL DEFAULT 0,
  bandwidth_cost             DECIMAL(14,8) NOT NULL DEFAULT 0,
  allocation_type            TEXT NOT NULL DEFAULT 'monthly', -- monthly | per_minute
  estimated_monthly_minutes  DECIMAL(10,2) NOT NULL DEFAULT 1000,
  is_current                 BOOLEAN NOT NULL DEFAULT true,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Retell-specific costs (singleton)
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

-- Markup / profit engine (singleton)
CREATE TABLE IF NOT EXISTS public.cost_engine_markup (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL DEFAULT 'Default',
  markup_type  TEXT NOT NULL DEFAULT 'percentage', -- fixed | percentage
  markup_value DECIMAL(14,8) NOT NULL DEFAULT 40,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customer plans
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

-- Per-call profitability log
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

-- RLS: all cost engine tables are platform-admin only (accessed via service role)
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

-- Service role bypasses RLS; grant read to authenticated (UI reads via service role anyway)
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

-- ── Seed default data ──────────────────────────────────────────────────────────

-- LLM defaults (approximate public pricing, admin can update)
INSERT INTO public.cost_engine_llm (provider, model, input_token_cost, output_token_cost, audio_input_cost, audio_output_cost, cached_token_cost, notes) VALUES
  ('OpenAI', 'gpt-4o-realtime-preview', 0, 0, 0.10, 0.20, 0, 'Audio: $0.10/min in, $0.20/min out'),
  ('OpenAI', 'gpt-4.1', 0.002, 0.008, 0, 0, 0.001, '$0.002/1K in, $0.008/1K out'),
  ('OpenAI', 'gpt-4.1-mini', 0.0004, 0.0016, 0, 0, 0.0001, '$0.0004/1K in, $0.0016/1K out'),
  ('Anthropic', 'claude-sonnet-4-5', 0.003, 0.015, 0, 0, 0.003, '$0.003/1K in, $0.015/1K out'),
  ('Anthropic', 'claude-opus-4-5', 0.015, 0.075, 0, 0, 0.015, '$0.015/1K in, $0.075/1K out'),
  ('Google', 'gemini-2.0-flash', 0.000125, 0.000375, 0, 0, 0, '$0.000125/1K in, $0.000375/1K out'),
  ('Retell', 'retell-llm-dynamic-general', 0, 0, 0, 0, 0, 'Included in Retell per-minute rate')
ON CONFLICT DO NOTHING;

-- Voice defaults
INSERT INTO public.cost_engine_voice (provider, voice_id, voice_name, cost_per_character, cost_per_minute, cost_per_request, notes) VALUES
  ('OpenAI', 'alloy',   'Alloy',   0, 0, 0, 'Included in GPT-4o Realtime audio output cost'),
  ('OpenAI', 'nova',    'Nova',    0, 0, 0, 'Included in GPT-4o Realtime audio output cost'),
  ('ElevenLabs', 'eleven_turbo_v2', 'Turbo v2', 0.00018, 0, 0, '$0.18 per 1K chars'),
  ('ElevenLabs', 'eleven_monolingual_v1', 'Monolingual v1', 0.00030, 0, 0, '$0.30 per 1K chars'),
  ('Cartesia', 'sonic-english', 'Sonic English', 0.00085, 0, 0, '$0.85 per 1K chars'),
  ('Deepgram', 'aura-asteria-en', 'Aura Asteria', 0.00200, 0, 0, '$2.00 per 1K chars'),
  ('Retell', 'included', 'Retell Default', 0, 0, 0, 'Included in Retell per-minute rate')
ON CONFLICT DO NOTHING;

-- Telephony defaults (Twilio approximate public rates)
INSERT INTO public.cost_engine_telephony (provider, country, inbound_cost_per_min, outbound_cost_per_min, recording_cost_per_min, number_rental_monthly, notes) VALUES
  ('Twilio', 'USA',       0.0085, 0.0140, 0.0025, 1.15, 'USD — approximate'),
  ('Twilio', 'UK',        0.0100, 0.0230, 0.0025, 1.15, 'USD — approximate'),
  ('Twilio', 'UAE',       0.0175, 0.0790, 0.0025, 2.00, 'USD — approximate'),
  ('Twilio', 'Canada',    0.0085, 0.0140, 0.0025, 1.15, 'USD — approximate'),
  ('Twilio', 'Australia', 0.0150, 0.0550, 0.0025, 1.75, 'USD — approximate'),
  ('FreJun', 'UAE',       0.0200, 0.0800, 0, 0, 'Estimated — confirm with FreJun'),
  ('FreJun', 'India',     0.0050, 0.0100, 0, 0, 'Estimated — confirm with FreJun')
ON CONFLICT DO NOTHING;

-- Default knowledge costs
INSERT INTO public.cost_engine_knowledge (embedding_cost_per_1k, vector_storage_per_gb_month, retrieval_cost_per_query, storage_per_gb_month, notes)
VALUES (0.00002, 0.095, 0.000001, 0.023, 'OpenAI text-embedding-3-small + Supabase pgvector approx')
ON CONFLICT DO NOTHING;

-- Default tool costs
INSERT INTO public.cost_engine_tools (webhook_cost_per_call, api_cost_per_call, crm_cost_per_month, calendar_cost_per_month, notes)
VALUES (0, 0, 0, 0, 'Update with actual integration costs')
ON CONFLICT DO NOTHING;

-- Default infrastructure (example)
INSERT INTO public.cost_engine_infrastructure (server_cost, database_cost, storage_cost, bandwidth_cost, allocation_type, estimated_monthly_minutes, notes)
VALUES (50, 25, 10, 5, 'monthly', 5000, 'Example monthly hosting costs in USD')
ON CONFLICT DO NOTHING;

-- Default Retell costs (approximate)
INSERT INTO public.cost_engine_retell (subscription_cost_monthly, minute_cost, number_cost_monthly, voice_cost_per_min, transfer_cost_per_min, notes)
VALUES (0, 0.05, 1.15, 0, 0.01, 'Retell $0.05/min (includes LLM+voice), check dashboard for exact rate')
ON CONFLICT DO NOTHING;

-- Default markup
INSERT INTO public.cost_engine_markup (label, markup_type, markup_value, notes)
VALUES ('Default', 'percentage', 40, '40% margin over cost')
ON CONFLICT DO NOTHING;

-- Default customer plans
INSERT INTO public.cost_engine_customer_plans (plan_name, description, included_minutes, price_per_month, price_per_minute, sort_order) VALUES
  ('Starter',      'Entry-level plan',        200,  49,  0.25, 0),
  ('Professional', 'Growing businesses',      1000, 149, 0.20, 1),
  ('Business',     'High-volume operations',  5000, 499, 0.15, 2),
  ('Enterprise',   'Custom & unlimited',      0,    0,   0.12, 3)
ON CONFLICT DO NOTHING;
