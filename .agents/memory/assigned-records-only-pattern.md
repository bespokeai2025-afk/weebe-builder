---
name: Assigned-records-only visibility pattern
description: How the assignedRecordsOnly RBAC flag is enforced across list server fns and where assignment does/doesn't exist.
---

Rule: any server fn that lists user-facing records must check
`resolvePermissions(workspaceId, userId).assignedRecordsOnly` and row-filter.

- Leads-backed surfaces (leads, pipeline, qualified, people views): `.eq("assigned_to", userId)` on the leads query.
- Lead-derived surfaces (calls, bookings, qualified data_records): no own assignment column — first fetch assigned lead ids, then `.in("lead_id", ids)`; return `[]` when the user has zero assigned leads (fail closed).
- No user-assignment concept: campaigns (page-level access only), data_records (`assigned_agent_id` is an AI agent, not a member) — documented via comments in those files.
- WBAH branches (derived from wbah_calls) carry no assignment → return `[]` for restricted roles.
- Cache caveat: any cached result must include the user in the cache key when assignedOnly (see listCalls `au:${userId}` key); otherwise skip the shared cache.

**Why:** restricted analyst/viewer roles were leaking whole-workspace rows on every surface except listLeads.
**How to apply:** when adding a new list/detail server fn over lead-linked data, copy the pattern from `src/lib/dashboard/calls.functions.ts` (derived) or `listLeads` (direct).
