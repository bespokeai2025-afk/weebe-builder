---
name: HiveMind executive control over GrowthMind
description: HiveMind CMO-oversight tool suite — registry tools, chat function-calling loop, pause flags, objectives, monitoring sweep.
---

# HiveMind executive control over GrowthMind

- ~30 `hivemind.*` tools in `src/lib/hivemind/growthmind-control/tools.server.ts` register via the shared Mind tool registry — all guards (membership → entitlement → mode gate → sensitive approval → zod → audit) come from `executeMindTool`; never bypass it or add bespoke checks.
- **Rule: reuse GrowthMind cores.** Write tools call extracted core functions (e.g. `applyTrendItemActionCore`, `createContentFromTrendCore`, `resolveDnaProposalCore`) — never duplicate business logic from server fns.
- Sensitive tools: `approve_content` (CAS-consumes a pending `hivemind_actions` approval, then calls the real publish-approval path, marks executed/failed truthfully), `update_growthmind_cost_limits` (billing), `resolve_dna_proposal`.
- Chat exposure: `chat-tools.server.ts` converts zod → JSON schema; `hivemind.ai.ts` runs a function-calling loop (MAX_ROUNDS=4) via `executeHiveMindChatTool` (initiatedBy:"user"); `approval_required` surfaces as honest `ok:false` — never claim success without a confirmed tool result.
- Governance flags on `workspace_settings`: `growthmind_publishing_paused` (publish tick), `growthmind_jobs_paused` (trend-discovery + CMO-analysis ticks), `growthmind_monthly_cost_limit_usd` (health check warns at 80%, critical at limit).
- `growthmind_objectives` (migration 20260724180000, applied live): active objectives are appended to the trend-scoring AI prompt as steering context (fails open if unreadable).
- Monitoring: `monitoring.server.ts` sweep turns failing health checks (`checks[]` shape: key/ok/severity/message/recommendedTool) into suggested `hivemind_tasks` (trigger_type `growthmind_health`, entity_id = check key; 23505 = deduped by the open-task partial unique index). Hooked hourly (minutes<5) into `proactive-engine.ts` — note the tick only covers workspaces with an OpenAI key configured.

**Why:** the exec layer must stay honest and approval-gated — GrowthMind is advisory; nothing publishes or spends without explicit human approval.
**How to apply:** when adding new HiveMind→GrowthMind capabilities, extract a core fn, register a tool with the right sensitive flag, and expose it via the chat converter — no new guard code.
