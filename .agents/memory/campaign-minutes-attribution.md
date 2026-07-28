---
name: Campaign minutes attribution
description: How calls are attributed to campaigns for minutes-used tracking; id-space and trust traps.
---

Campaign minutes-used tracking attributes calls in strict order: explicit `calls.campaign_id` → unambiguous agent→campaign mapping → "Unassigned Campaign" bucket. Never guess.

**Id-space trap:** `calls.agent_id` stores PROVIDER (Retell) agent ids, while `campaigns.agent_id` is the local `agents`-row uuid. Any agent-based fallback attribution MUST resolve campaign agents to provider ids (agents.retell_agent_id, stripped of `published_`/`draft_` prefix, plus `settings.deployedRetellAgentId`) or it silently matches nothing.

**Webhook trust rule:** `metadata.campaign_id` on Retell webhooks is untrusted input. Before persisting, verify in DB that the campaign exists AND belongs to the resolved workspace; fail closed to null (unassigned). A workspace-match check on metadata alone is insufficient when metadata.workspace_id is absent.

**Dedup rule:** always dedupe by `retell_call_id`; fallback key must be the deterministic local row id — never `Math.random()` (non-deterministic keys defeat dedup and inflate KPIs).

**Filter consistency:** when a campaignId filter is applied, workspace totals/unassigned/series must all be recomputed from the scoped call set, not just the campaign row list — otherwise tiles and table disagree.

**How to apply:** shared core is `src/lib/analytics-hub/campaign-usage.shared.ts` (+ `.server.ts`); historic un-attributable calls stay Unassigned by design (`scripts/backfill-campaign-minutes.mjs` is idempotent/conservative).

**Billing rate cost:** platform rate is £0.36/min (`BILLING_RATE_GBP_PER_MINUTE` in the shared core); `rateCostGbp` is derived minutes×rate on every bucket and is deliberately separate from `totalCostCents` (real recorded provider cost only) — never merge or substitute them.
