---
name: HiveMind full data connections + freshness
description: How HiveMind's data-health and exec-intelligence blocks work, and the isolation rules for platform-wide tables.
---

# HiveMind data connections & freshness tracking

- `src/lib/hivemind/data-health.server.ts` — `getWorkspaceDataHealth(workspaceId, isWbah)` probes 8 sources (calls/leads/calendar/email/whatsapp/gads/billing/campaigns) via head-count + windowed order-limit-1; statuses healthy|stale|degraded|disconnected|empty; 60s in-process cache + `checkCacheSignal` cross-instance invalidation; invalidate via `invalidateDataHealth(wsId)`.
- `src/lib/hivemind/exec-intelligence.server.ts` — calendar/email/onboarding/billing blocks, wired into `fetchFullPlatformData` via `Promise.allSettled` so any block degrades to null; prompt sections in `buildPlatformContext` include a DATA-SOURCE HEALTH honesty rule.

**Isolation rules learned (review-flagged):**
- `suppressed_emails` has NO workspace_id (platform-wide). Only look up addresses whose sends FAILED for the querying workspace — never probe successfully-delivered addresses, or a tenant can infer another tenant's suppression activity.
- `workspace_requests` pending count is platform-global; only surface it when the workspace owner is a platform admin (`profiles.user_type = 'admin'`).
- Usage sums from `usage_events` must page past PostgREST's 1000-row cap (paged loop + truncation flag), not a single capped fetch — otherwise overage/upsell flags undercount.

**WBAH:** health probes and intelligence blocks use `wbah_calls` only; the leads join for qualified-no-booking is skipped entirely for WBAH.

**Test fixture notes:** `leads.source` enum has no "webform" — use "website". e2e: `tests/e2e/hivemind-data-connections.e2e.test.ts` (fixture workspaces need slug + owner_id; explicit table cleanup, no cascade).
