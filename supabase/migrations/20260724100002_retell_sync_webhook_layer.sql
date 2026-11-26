-- Task #458: Retell deployment sync, extraction & webhook management layer
-- Additive + idempotent. Server-write-only tables (REVOKE from authenticated).

-- ── Deployment sync state per WEBEE agent ────────────────────────────────────
CREATE TABLE IF NOT EXISTS retell_deployment_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL UNIQUE,
  retell_agent_id text,
  conversation_flow_id text,
  last_deployed_config jsonb,
  last_deployed_hash text,
  last_live_hash text,
  last_deploy_status text NOT NULL DEFAULT 'never',
  last_deploy_error text,
  last_deployed_at timestamptz,
  extraction_schema jsonb,
  extraction_verified boolean NOT NULL DEFAULT false,
  extraction_verified_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retell_deploy_state_ws ON retell_deployment_state (workspace_id);

ALTER TABLE retell_deployment_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retell_deployment_state FROM authenticated, anon;
GRANT SELECT ON retell_deployment_state TO authenticated;
DROP POLICY IF EXISTS retell_deploy_state_members_read ON retell_deployment_state;
CREATE POLICY retell_deploy_state_members_read ON retell_deployment_state
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = retell_deployment_state.workspace_id
      AND m.user_id = auth.uid()
  ));

-- ── Workspace-scoped webhook config (secret stays server-only) ──────────────
CREATE TABLE IF NOT EXISTS retell_webhook_config (
  workspace_id uuid PRIMARY KEY,
  secret text NOT NULL,
  verification_enabled boolean NOT NULL DEFAULT false,
  replay_window_seconds integer NOT NULL DEFAULT 300,
  last_event_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE retell_webhook_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retell_webhook_config FROM authenticated, anon;

-- ── Webhook processing ledger: dedup, replay, retry, dead-letter ─────────────
CREATE TABLE IF NOT EXISTS retell_webhook_processing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  event_log_id uuid,
  dedup_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  retell_call_id text,
  status text NOT NULL DEFAULT 'processed',
  attempts integer NOT NULL DEFAULT 1,
  next_retry_at timestamptz,
  last_error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retell_wh_processing_ws ON retell_webhook_processing (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retell_wh_processing_retry ON retell_webhook_processing (status, next_retry_at)
  WHERE status IN ('failed','retrying');

ALTER TABLE retell_webhook_processing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retell_webhook_processing FROM authenticated, anon;
