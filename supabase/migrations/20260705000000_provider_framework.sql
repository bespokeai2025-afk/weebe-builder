-- Universal Provider Framework
-- provider_settings: per-workspace provider credentials, status, priority
-- provider_usage: per-request cost/duration/error tracking per workspace+provider

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

CREATE POLICY "workspace_members_provider_settings"
  ON provider_settings FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS provider_usage_workspace_idx  ON provider_usage (workspace_id);
CREATE INDEX IF NOT EXISTS provider_usage_cost_idx       ON provider_usage (workspace_id, total_cost_usd DESC);

ALTER TABLE provider_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_provider_usage"
  ON provider_usage FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
