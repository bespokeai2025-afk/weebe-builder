---
name: WBAH analytics uses Retell API only (never both sources)
description: On the analytics page WBAH reads from its own Retell API for real per-agent data; every other WBAH page uses wbah_calls. Never merge both — that double-counts.
---

# WBAH analytics page = Retell API only; all other WBAH pages = wbah_calls

For the WBAH workspace (slug `webuyanyhouse`), the **analytics page only**
(`getRetellAnalytics` + `listVoiceAgents`) reads from WBAH's **own Retell key**
(`workspace_settings.retell_workspace_id`), exactly like any other Retell
workspace. It does NOT also read `wbah_calls`. Every OTHER WBAH surface
(`getOverviewStats`, People tabs, pipeline, calls/leads lists) still reads
`wbah_calls` unchanged.

**Why this flipped (was: "wbah_calls only, gate Retell with `!isWbah`"):**
- The WeeBespoke→`wbah_calls` sync drops agent identity (`agent_name` is NULL for
  ~100% of rows), so that feed CANNOT power a per-agent view or the agent-selector
  dropdown. Users needed all 5 WBAH agents visible + per-agent filtering.
- WBAH has its own Retell account with 5 agents and full attribution. The SAME
  calls live there WITH agent names, and volumes match closely (verified live:
  Retell 30d ≈7,397 vs synced wbah_calls ≈7,173). So the analytics page switched
  to the Retell source to get real per-agent data.

**The invariant that still holds — exactly ONE source, never both:**
These are the SAME underlying calls stored twice (Retell `call_*` ids vs
`wbah_calls` UUIDs). If `getRetellAnalytics` ever read BOTH for WBAH, "All agents"
would double-count. The fix keeps `wbahCalls` as a hard-coded empty array in
`getRetellAnalytics` so the two sources can never merge.

**How to apply:**
- `getRetellAnalytics` Retell gate is `if (apiKey)` (NOT `if (apiKey && !isWbah)`);
  the wbah_calls block is replaced by `const wbahCalls: any[] = []`.
- `listVoiceAgents` skip is `if (!ctx.apiKey)` (NOT `if (ctx.isWbah || !ctx.apiKey)`)
  and dedupes `/list-agents` by `agent_id` (keep latest by
  `last_modification_timestamp`) — Retell returns one row per agent VERSION (WBAH:
  36 rows → 5 agents).
- Frontend `analytics.tsx`: `effectiveSelectedAgentId = selectedAgentId` (no
  `isWbah` force-null); the agent dropdown and Per-Agent Breakdown are NOT gated by
  `!isWbah` anymore. `isWbah` is still used for the includeVm default, credits tab,
  and visibleTabs.
- Retell `v2/list-calls` returns a **bare array** and paginates via the LAST call's
  `call_id` (no `pagination_key` field) — continue only while a page is full:
  `paginationKey = res?.pagination_key ?? (page.length === PAGE_SIZE ? last call_id : undefined)`.
  This un-caps a latent 1-page/1000-call limit for ALL workspaces on this page.
- Bump the analytics cache key (`retellAnalyticsKey`) AND the agents key
  (`retellAgentsKey`) in lockstep on any count/shape change, or stale entries serve
  for the TTL after deploy.
- Consequence of the user decision: if the WBAH Retell fetch fails, the page shows
  "not configured" instead of falling back to wbah_calls. Accepted.

## WBAH UI gating on the Analytics page
The Credits tab (and other WBAH-specific UI) must gate on `useIsWbahWorkspace()` (fast active-workspace slug resolver), NOT on `workspaceSlug` from the heavy getRetellAnalytics payload — if that load is slow/fails, the tab silently disappears ("credits page gone" bug, fixed 2026-07-20). Keep the payload slug only as a pre-resolve fallback.
