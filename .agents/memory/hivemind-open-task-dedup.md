---
name: HiveMind open-task atomic dedup
description: DB-level dedup pattern for hivemind_tasks and Stage-2 reasoning/accountability constraints
---

# HiveMind open-task atomic dedup

Rule: dedup of agent-generated hivemind_tasks is enforced by a partial unique index
`hivemind_tasks_open_trigger_entity_uq` on (workspace_id, trigger_type, entity_id)
WHERE status <> 'completed' AND both cols NOT NULL (migration 20260723130000, applied live).

**Why:** in-memory "check open tasks then insert" prechecks are not race-safe — concurrent
scheduled + on-demand reasoning runs created duplicate accountability tasks. Recommendations
were already safe via unique (workspace_id, dedupe_key) + upsert; tasks needed the same.

**How to apply:**
- Any code inserting hivemind_tasks with trigger_type+entity_id must insert row-by-row and
  treat error code 23505 as "deduped", not a failure.
- Any UPDATE that reopens a completed task (status back to an open state) can hit the index
  if a fresh open task exists — on error, leave it completed and null reassess_at.
- Stage-2 accountability rechecks (TRIGGER_RECHECKS) must respect the WBAH split: never query
  `leads` for the WBAH workspace (lead_stale recheck skips WBAH, returns "cleared").
