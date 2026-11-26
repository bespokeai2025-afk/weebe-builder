-- One pending manual-pass (test-gate override) request per build session.
-- Applied live via the Supabase Management API on 2026-07-14.
CREATE UNIQUE INDEX IF NOT EXISTS uq_smga_pending_test_override
  ON systemmind_generated_actions (workspace_id, ((payload->>'session_id')))
  WHERE action_kind = 'build_test_override' AND status = 'pending_approval';
