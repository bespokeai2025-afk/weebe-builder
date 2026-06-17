-- ─────────────────────────────────────────────────────────────────────────────
-- DEVELOPER API MIGRATION
-- Run manually in Supabase SQL Editor
-- Tables: workspace_webhooks, webhook_deliveries
-- Alters: workspace_api_tokens (adds permissions_json, expires_at)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend workspace_api_tokens with permissions + expiry
ALTER TABLE public.workspace_api_tokens
  ADD COLUMN IF NOT EXISTS permissions_json JSONB NOT NULL DEFAULT '["*"]'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ;

-- 2. Outbound webhook subscriptions
CREATE TABLE IF NOT EXISTS public.workspace_webhooks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  event_type   TEXT        NOT NULL, -- 'lead.created', 'call.completed', etc.
  target_url   TEXT        NOT NULL,
  secret       TEXT        NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_webhooks_isolation" ON public.workspace_webhooks;
CREATE POLICY "workspace_webhooks_isolation" ON public.workspace_webhooks
  USING (workspace_id = ((auth.jwt() -> 'user_metadata') ->> 'workspace_id')::uuid);

CREATE INDEX IF NOT EXISTS workspace_webhooks_workspace_id_idx ON public.workspace_webhooks(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_webhooks_event_type_idx   ON public.workspace_webhooks(event_type);

-- 3. Webhook delivery log + retry queue
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  webhook_id    UUID        REFERENCES public.workspace_webhooks(id) ON DELETE SET NULL,
  event_type    TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','retrying')),
  response_code INTEGER,
  response_body TEXT,
  attempt_count INTEGER     NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at  TIMESTAMPTZ
);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_deliveries_isolation" ON public.webhook_deliveries;
CREATE POLICY "webhook_deliveries_isolation" ON public.webhook_deliveries
  USING (workspace_id = ((auth.jwt() -> 'user_metadata') ->> 'workspace_id')::uuid);

CREATE INDEX IF NOT EXISTS webhook_deliveries_workspace_id_idx ON public.webhook_deliveries(workspace_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_id_idx   ON public.webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx       ON public.webhook_deliveries(status) WHERE status IN ('pending','retrying');

-- 4. In-memory rate limit log (ephemeral — truncated daily by pg_cron if desired)
CREATE TABLE IF NOT EXISTS public.api_rate_limit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL,
  token_id     UUID        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', now()),
  request_count INTEGER    NOT NULL DEFAULT 1,
  UNIQUE (token_id, window_start)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_log_token_window_idx ON public.api_rate_limit_log(token_id, window_start);
