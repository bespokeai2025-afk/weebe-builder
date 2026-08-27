---
name: Auto SEO campaign tick
description: Opt-in cadence tick that auto-creates SEO blog campaigns (approval-first); CAS claim + fail-closed reads.
---

# Auto SEO campaign tick

- Opt-in via `workspace_settings.seo_auto_campaigns_per_week` (0 = off, clamp ≤7); `seo_auto_last_created_at` is the CAS claim column.
- Tick lives in `src/lib/growthmind/seo-campaign-tick.ts`; registered in prod campaign-executor route AND dev campaign-scheduler plugin (ssrLoadModule, module uses `@/` aliases).
- Approval-first by construction: it only calls `createSeoCampaignCore` → campaign at `awaiting_strategy_approval` + sensitive hivemind action. Never add anything that advances stages.
- **Why the CAS claim:** pg_cron double-fires and dev+prod ticks can race; the weekly `[Auto] ` name-prefix count is not a concurrency control. The atomic UPDATE (gap re-checked in the WHERE) makes exactly one instance win; a failed create after claim just skips one slot.
- **Fail closed on reads:** cadence/dedup query errors must skip the workspace — an empty result from a failed read would look like "nothing exists, create away".
- Topic pick: GSC `detectOpportunities` first (high-conf first, word-overlap dedup vs existing campaigns/calendar), Business-DNA fallback, skip if no unique topic — never invent from nothing.
- **How to apply:** any new autonomous "create proposals on a schedule" feature should copy this shape (opt-in column, CAS claim, fail-closed reads, `[Auto] ` marker).
