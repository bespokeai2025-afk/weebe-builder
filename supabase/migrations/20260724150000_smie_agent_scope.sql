-- Scope integration errors per workflow: add agent_id/activation_id so health
-- and wizard evidence never blame one workflow for another's errors.
ALTER TABLE systemmind_integration_errors ADD COLUMN IF NOT EXISTS agent_id uuid;
ALTER TABLE systemmind_integration_errors ADD COLUMN IF NOT EXISTS activation_id uuid;
CREATE INDEX IF NOT EXISTS idx_smie_ws_agent ON systemmind_integration_errors (workspace_id, agent_id, status);
-- Backfill from linked queue entries (best effort, idempotent).
UPDATE systemmind_integration_errors e
SET agent_id = q.agent_id, activation_id = q.activation_id
FROM systemmind_call_queue q
WHERE e.queue_id = q.id AND e.agent_id IS NULL;
