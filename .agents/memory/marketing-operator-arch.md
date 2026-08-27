---
name: Marketing Operator
description: Durable safety/behavior rules for the HiveMind Marketing Operator (objectives, daily tick, measurement & learning).
---

# Marketing Operator — durable rules

- **All execution goes through the Marketing Action Engine.** The operator (including autopilot) only *submits* low-risk `recommended` actions via the engine's submit path; the engine's autonomy level and guardrails remain the sole execution authority. Never add a bypass.
- **Honest measurement, fail closed.** Any errored Supabase read in a metric/measurement window means "unknown", never zero: no baseline persisted, classification `inconclusive`, no conversion-drop finding. Both before/after windows must independently carry volume before calling an action successful; >1 overlapping same-platform action in the window = `inconclusive`.
- **Findings dedupe** by partial unique index on live rows — insert row-by-row and treat 23505 as an expected dedupe, never bulk insert.
- **Daily tick concurrency** = CAS claim on `workspace_settings.marketing_operator_last_run_at` (~20h window); the enabled-workspace scan is paginated so growth past one page can't drop workspaces.
- **Objective↔action linkage is resolved, not produced.** Gads engine actions carry no objective context; a resolver backfills `objective_id` only when attribution is unambiguous (exactly one active google_ads objective). With 2+ active objectives it refuses to guess.
- **Learning is proposal-only**: outcomes feed bounded confidence (`marketing:<action_type>`) and *proposed* GrowthMind learned patterns; nothing auto-applies.

**Why:** the whole feature's trust model is "never fake success, never act outside the engine" — every incident class above (bogus zeros, double ticks, mis-attribution) was caught in review.
