---
name: Analytics multi-tenant isolation on the shared Retell platform key
description: Standard-workspace Retell analytics must fail closed to deployed agents; null allow-list = cross-workspace leak.
---

# Analytics isolation when using the shared platform Retell key

**Rule:** In `getRetellAnalytics` (analytics page, non-WBAH path), the per-workspace
allow-list `deployedAgentIds` MUST fail **closed** when the workspace is on the
shared platform key (`process.env.RETELL_API_KEY`, i.e. no `workspace_settings.
retell_workspace_id`). Initialize it to an empty `Set` *before* the deployments
lookup and only add the workspace's own deployed `provider_agent_id`s. Never leave
it `null` on that path.

**Why:** The platform Retell key sees EVERY workspace's agents on the account. The
downstream filter is `if (deployedAgentIds !== null && !deployedAgentIds.has(id)) continue;`
— so `null` means "no filter" = include all agents = a multi-tenant data leak. The
old code only assigned `deployedAgentIds` when deployments existed, so a standard
workspace with zero recorded deployments (or if the lookup threw) silently showed
every other workspace's calls. User-reported as "analytics on my normal account
should be linked to the workspace id." Fail closed = a legit no-deployment workspace
shows `configured:false` / "No deployed agents found" instead of leaking.

**Same isolation rule now shared by two fns.** `getRetellAnalytics` and the agent-
filter's dedicated `listVoiceAgents` server fn both derive key + allow-list from one
helper (`resolveRetellContext`) so the fail-closed rules stay identical. The agent
dropdown MUST be sourced from `listVoiceAgents` (the workspace's own Retell
`/list-agents`), NOT from the cached calls response — otherwise only agents that
happen to have calls in the window appear. Its cache key is workspace-scoped
(`webee:analytics:${ws}:retell-agents:vN`, 5-min TTL) and `listVoiceAgents` returns
empty for WBAH/no-key. Frontend unions `voiceAgentsQ.data.agents` with call-derived
`agentNames`, keyed by provider `agent_id` so the client-side `c.agent_id === selected`
filter keeps working.

**How to apply:**
- The workspace-OWN-key path (`workspaceRetellKey` set) intentionally keeps
  `deployedAgentIds = null` — every agent on that key already belongs to the
  workspace, so no filtering is correct there. Don't "fix" that.
- Date windows floor to whole UTC days (`startOfUtcDayMs(now) − (days−1)·24h`) on the
  server; the client "Today" narrowing uses `setUTCHours(0,0,0,0)` — keep them on the
  same UTC boundary or trend buckets and totals disagree.
- WBAH is unaffected: the whole Retell-API block is gated by `!isWbah` (WBAH uses
  `wbah_calls`). The dashboard `getOverviewStats` is also unaffected — it reads the
  `calls` table scoped by `workspace_id`, never the Retell API agent list.
- Any change to what this fn counts/returns must bump the analytics cache key
  (`webee:analytics:${ws}:retell:vN`) in lockstep, or the 15-min TTL keeps serving
  the old (leaked) shape after deploy. This is the same lockstep rule as other
  driver/analytics caches.
