-- growthmind_model_settings: per-workspace AI routing mode
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

CREATE POLICY "workspace members can manage model settings"
  ON growthmind_model_settings FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- growthmind_generation_logs: per-generation cost & model tracking
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
CREATE INDEX IF NOT EXISTS idx_gm_gen_logs_asset ON growthmind_generation_logs(asset_id);

ALTER TABLE growthmind_generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage generation logs"
  ON growthmind_generation_logs FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
