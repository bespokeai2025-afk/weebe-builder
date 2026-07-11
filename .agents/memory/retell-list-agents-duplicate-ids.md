---
name: Retell /list-agents duplicate agent_ids
description: Retell's /list-agents returns the same agent_id multiple times; how the dashboard agent selector must dedupe.
---

# Retell /list-agents returns duplicate agent_ids

Retell's `/list-agents` API can return the **same `agent_id` multiple times** — one
row per published version of the agent (observed live: one deployed agent appearing
6× in a client workspace with 100 rows). Any code that builds a dashboard/selector
list from this endpoint must dedupe by `agent_id` right after fetching.

Deduping by `agent_id` alone is **not enough**. A single local `agents` row can also
surface through several channels that all collapse to the same local row id:
- its deployed (live) Retell agent — `settings.deployedRetellAgentId`
- its builder-draft Retell agent — the `retell_agent_id` column
- the local-only fallback (agents not covered by the Retell list)

So the final list must also be **collapsed to one entry per local row id**, preferring
the deployed match (it carries the correct live name + Retell phone number), then any
Retell-mapped entry, then the local-only fallback. Distinct agents never share a local
id (it's the DB primary key), so this dedupe can never drop a legitimately-different
agent — even when several agents share a display name (e.g. multiple "Alex").

**Why:** the leads-page "Assign Qualification Agent" `<Select>` showed one agent 6–8×,
every duplicate rendered as "selected" (checkmark). Radix Select's `ItemIndicator`
marks *every* item whose `value` equals the current value; the dashboard uses the local
row id as the option value, so all same-id duplicates check-marked together.

**How to apply:** the central builder is `getDashboardLiveAgents` in
`src/lib/agents/agents.functions.ts` (consumed by leads, qualified, analytics, and
PrefetchOnLogin — fix it there, not per-page). The no-Retell-key paths (no
`context.workspaceId`, or `retell_workspace_id` not starting with `key_`) return
`localLive` directly and are unaffected (local rows can't have duplicate ids).
