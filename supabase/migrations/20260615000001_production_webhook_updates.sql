-- Audit log for all production webhook URL update operations
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

CREATE INDEX IF NOT EXISTS idx_prod_webhook_updates_workspace
  ON production_webhook_updates(workspace_id);

CREATE INDEX IF NOT EXISTS idx_prod_webhook_updates_provider
  ON production_webhook_updates(provider);

CREATE INDEX IF NOT EXISTS idx_prod_webhook_updates_created
  ON production_webhook_updates(created_at DESC);

COMMENT ON TABLE production_webhook_updates IS
  'Immutable audit log of every webhook URL update performed by the production readiness system.';
