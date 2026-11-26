ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS voice_provider TEXT NOT NULL DEFAULT 'RETELL'
    CHECK (voice_provider IN ('RETELL', 'OPENAI_REALTIME'));

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT,
  ADD COLUMN IF NOT EXISTS openai_realtime_inbound_url TEXT;
