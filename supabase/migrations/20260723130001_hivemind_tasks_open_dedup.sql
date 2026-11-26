-- Task #395 follow-through: DB-level atomic dedup for open accountability
-- tasks. In-memory prechecks are not race-safe; this partial unique index
-- guarantees at most ONE non-completed task per (workspace, trigger, entity).
-- Verified before creation: no existing duplicate open rows.
CREATE UNIQUE INDEX IF NOT EXISTS hivemind_tasks_open_trigger_entity_uq
  ON hivemind_tasks (workspace_id, trigger_type, entity_id)
  WHERE status <> 'completed' AND trigger_type IS NOT NULL AND entity_id IS NOT NULL;
