---
name: Executive bridge (HiveMind COO ↔ GrowthMind CMO)
description: How the AI executive council layer is wired and the rules new executives must follow.
---

# Executive bridge architecture

HiveMind is the only user-facing executive (acting COO). GrowthMind is an advisory CMO that
reports up to HiveMind and **recommends only — it never executes**. Future execs (SystemMind/CTO,
SalesMind/CSO, FinanceMind/CFO) are declared as `planned` placeholders in `executive-council.ts`.

**Why:** keeps a single conversational surface (HiveMind) and a stable summary contract so new
executives plug in without a redesign; the advisory-only rule prevents GrowthMind from creating
execution ActionTypes behind the user's back.

**How to apply:**
- Shared, client-safe types/constants live in `src/lib/executives/executive-council.ts` — never
  import server code here. UI imports the contract types from this file.
- Server-only builders live in `executive-bridge.server.ts`. They must be reached **only** through
  dynamic `await import()` inside server-fn handlers (in `executive-bridge.ts`) or inside other
  server-only functions — never a static client import, or the client bundle pulls secrets.
- `buildHiveMindExecutiveSummary` must whitelist safe fields and never forward `fetchFullPlatformData`'s
  raw `cfg` (workspace settings hold API keys).
- The bridge reuses GrowthMind engines (`computeGrowthScore`, `generateGrowthRecommendations`,
  `detectLeadOpportunities`, `getOpportunitySummary`) — do not re-derive marketing metrics.
- GrowthMind→HiveMind handoff: `scanGrowthMind` tags findings with
  `metadata.executive_task_type` (one of `EXECUTIVE_TASK_TYPES`); HiveMind decides task/action/ignore.
- Shared `executive_events` table dedups inserts within 6h; its migration is applied **manually** in
  the Supabase SQL Editor (Supabase DDL can't run via the JS client in this sandbox).
- Known follow-up (architect-approved): chat/voice/briefing each rebuild the GrowthMind summary in
  parallel with platform data → double aggregation. Cache per-request if it becomes a latency issue.
