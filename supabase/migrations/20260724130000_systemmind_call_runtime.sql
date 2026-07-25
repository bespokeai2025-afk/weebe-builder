-- Task #460 (expanded): SystemMind call runtime — triggers, queue, attempts,
-- executions, integration errors, activations/health.
-- Additive + idempotent. Members can SELECT (workspace_members RLS); all
-- writes are server-only (REVOKE INSERT/UPDATE/DELETE from authenticated).

-- ── Call trigger definitions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS systemmind_call_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  agent_id uuid,
  workflow_id uuid,
  activation_id uuid,
  name text NOT NULL DEFAULT '',
  trigger_type text NOT NULL DEFAULT 'manual',
  enabled boolean NOT NULL DEFAULT false,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  calling_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_attempts integer NOT NULL DEFAULT 3,
  daily_cap integer NOT NULL DEFAULT 100,
  retry_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_window_minutes integer NOT NULL DEFAULT 1440,
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  last_evaluated_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smct_trigger_type_check CHECK (trigger_type IN (
    'manual','crm_lead_created','crm_lead_changed','webee_lead_created',
    'webee_lead_status','csv_upload','webform','scheduled','delay_after_creation',
    'callback','api_webhook'
  ))
);
CREATE INDEX IF NOT EXISTS idx_smct_ws ON systemmind_call_triggers (workspace_id, enabled);

-- ── Call queue ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS systemmind_call_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  trigger_id uuid,
  activation_id uuid,
  agent_id uuid,
  lead_id text,
  lead_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 100,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  call_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  dynamic_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedup_key text,
  last_error text,
  status_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smcq_status_check CHECK (status IN (
    'pending','preparing','waiting_for_data','ready','calling','connected',
    'completed','failed','retry_scheduled','callback_scheduled','paused',
    'cancelled','suppressed'
  ))
);
CREATE INDEX IF NOT EXISTS idx_smcq_ws_status ON systemmind_call_queue (workspace_id, status, next_attempt_at);
-- Open-entry dedup: one live queue row per (workspace, dedup_key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_smcq_open_dedup ON systemmind_call_queue (workspace_id, dedup_key)
  WHERE dedup_key IS NOT NULL
    AND status IN ('pending','preparing','waiting_for_data','ready','calling','connected','retry_scheduled','callback_scheduled','paused');

-- ── Call attempts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS systemmind_call_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  queue_id uuid NOT NULL REFERENCES systemmind_call_queue(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  retell_call_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  outcome text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smca_ws ON systemmind_call_attempts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smca_queue ON systemmind_call_attempts (queue_id);
CREATE INDEX IF NOT EXISTS idx_smca_retell ON systemmind_call_attempts (retell_call_id);

-- ── Workflow executions + per-step timeline ─────────────────────────────────
CREATE TABLE IF NOT EXISTS systemmind_workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  activation_id uuid,
  trigger_id uuid,
  queue_id uuid,
  agent_id uuid,
  lead_id text,
  kind text NOT NULL DEFAULT 'call_run',
  status text NOT NULL DEFAULT 'running',
  trigger_source text NOT NULL DEFAULT '',
  idempotency_key text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smwe_status_check CHECK (status IN ('running','completed','failed','partial','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_smwe_idem ON systemmind_workflow_executions (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_smwe_ws ON systemmind_workflow_executions (workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS systemmind_execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES systemmind_workflow_executions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  step_key text NOT NULL,
  step_label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  input_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_response_masked jsonb,
  error text,
  resolution_hint text,
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smes_status_check CHECK (status IN ('running','completed','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS idx_smes_exec ON systemmind_execution_steps (execution_id, started_at);
CREATE INDEX IF NOT EXISTS idx_smes_ws ON systemmind_execution_steps (workspace_id, created_at DESC);

-- ── Integration errors (CRM write-back retries, dead-letter — never silent) ──
CREATE TABLE IF NOT EXISTS systemmind_integration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  execution_id uuid,
  queue_id uuid,
  kind text NOT NULL DEFAULT 'crm_writeback',
  operation jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NOT NULL DEFAULT '',
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smie_status_check CHECK (status IN ('pending','retrying','resolved','dead_letter'))
);
CREATE INDEX IF NOT EXISTS idx_smie_ws ON systemmind_integration_errors (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smie_retry ON systemmind_integration_errors (status, next_retry_at)
  WHERE status IN ('pending','retrying');

-- ── Workflow activations: wizard state, versioning, test results, health ─────
CREATE TABLE IF NOT EXISTS systemmind_workflow_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  agent_id uuid,
  session_id uuid,
  crm_connection_id uuid,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  version_number integer NOT NULL DEFAULT 1,
  parent_activation_id uuid,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  test_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_test_at timestamptz,
  test_passed boolean,
  admin_override boolean NOT NULL DEFAULT false,
  override_reason text,
  override_by_user_id uuid,
  activated_by_user_id uuid,
  activated_at timestamptz,
  deactivated_at timestamptz,
  health_status text NOT NULL DEFAULT 'unknown',
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_checked_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smwa_status_check CHECK (status IN ('draft','testing','active','paused','superseded','rolled_back')),
  CONSTRAINT smwa_health_check CHECK (health_status IN ('unknown','healthy','warning','degraded','failed','paused'))
);
CREATE INDEX IF NOT EXISTS idx_smwa_ws ON systemmind_workflow_activations (workspace_id, status, created_at DESC);
-- Only one ACTIVE activation per (workspace, agent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_smwa_one_active ON systemmind_workflow_activations (workspace_id, agent_id)
  WHERE status = 'active';

-- ── RLS: members read, server-only writes ────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'systemmind_call_triggers','systemmind_call_queue','systemmind_call_attempts',
    'systemmind_workflow_executions','systemmind_execution_steps',
    'systemmind_integration_errors','systemmind_workflow_activations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM authenticated, anon', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_members_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (EXISTS (
         SELECT 1 FROM workspace_members m
         WHERE m.workspace_id = %I.workspace_id AND m.user_id = auth.uid()))',
      t || '_members_read', t, t
    );
  END LOOP;
END $$;
