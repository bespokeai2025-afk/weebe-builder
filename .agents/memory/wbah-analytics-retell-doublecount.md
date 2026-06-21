---
name: WBAH analytics Retell double-count & agent misattribution
description: Why WBAH analytics must use wbah_calls as the SOLE source and never also merge the Retell API.
---

# WBAH analytics: never merge the Retell API alongside wbah_calls

For the WBAH workspace (slug `webuyanyhouse`), `getRetellAnalytics` must rely
**solely** on the `wbah_calls` table and must NOT also pull from the Retell API
(`list-agents` / `list-calls`). The Retell path is gated with `!isWbah`.

**Why:**
- WBAH calls are synced from the WeeBespoke API into `wbah_calls` with
  `agent_name = NULL` for ~100% of rows. The code buckets every such row under a
  single synthetic agent ("WeeBespoke Agent").
- WBAH also has a workspace-level Retell key (`workspace_settings.retell_workspace_id`),
  so analytics previously ALSO hit the Retell API and merged calls that ARE
  correctly attributed to the named agents (e.g. "WBAH Client qualification agent").
- These are the SAME underlying calls (verified: identical caller ID, destination
  numbers, and timestamps appear in both `wbah_calls` and the Retell API), stored
  twice with different IDs (`wbah_calls.id` is a UUID; Retell uses `call_*`) and
  different attribution. Result: "All agents" double-counted the most recent page
  of calls, and selecting the named agent showed only that small Retell page while
  the bulk stayed under "WeeBespoke Agent" — so the named agent looked like it had
  FEWER calls than "All agents".
- Retell `v2/list-calls` returns a **bare array** (no `pagination_key`), so the
  merge only ever fetched one page (max 1,000) anyway — partial AND duplicated.

**How to apply:**
- Keep the `if (apiKey && !isWbah)` gate on the Retell path. Non-WBAH workspaces
  must keep the full Retell + per-agent behavior.
- On the analytics page, hide the agent selector and the Per-Agent Breakdown for
  WBAH (`!isWbah`) and force any persisted selection to null
  (`effectiveSelectedAgentId = isWbah ? null : selectedAgentId`) — per-agent split
  is impossible until the WeeBespoke sync preserves agent identity.
- Bump the analytics cache key (`retellAnalyticsKey`, currently `...:retell:v2:...`)
  whenever the WBAH merge logic changes, or stale double-counted entries serve for
  the 15-min TTL after deploy.
