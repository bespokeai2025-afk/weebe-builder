---
name: GrowthMind Phase 5 performance & learning loop
description: Checkpointed post-performance snapshots, accept/reject learning engine, chat tool actions — key constraints and traps.
---

- Snapshots: checkpoint ladder 1h/6h/24h/72h/7d/30d; checkpoint key stored inside `metrics.checkpoint` JSONB of `growthmind_performance_snapshots` (table pre-existed and is already in RETENTION_RULES). Capture errors stored as `metrics.capture_error` and surfaced honestly in the UI, never hidden.
- Attribution is a windowed-source heuristic (social-sourced leads/bookings created after publish) — every surface that shows it must say it's an estimate, not pixel tracking.
- Learning engine NEVER silently changes scoring: patterns land as `proposed` rows in `growthmind_learned_patterns`; only user-accepted rows feed `computeLearningMultiplier` (each adjustment clamped ±0.2, combined multiplier clamped [0.7,1.3]). Resolution is CAS on `status='proposed'`; dedup via partial unique index on open (ws,kind,key) — insert row-by-row, 23505 = deduped.
- `growthmind_learned_patterns` deliberately NOT in RETENTION_RULES (small, decision history has value); superseded rows use status `expired`.
- Chat tools: GrowthMind AI uses an OpenAI function-calling loop; writes are only (a) recommendation → Content Studio (via `createProjectFromRecommendationCore`, extracted so both the server fn and the audited chat tool share it) and (b) rescheduling ALREADY-approved/scheduled publish jobs (CAS on status). Unapproved content can never be scheduled from chat — approval stays in HiveMind. All writes audited via `auditServerFnToolRun` and declared in the mind tool registry.

**Why:** the user requirement was "never silently rewrite DNA / never fake success" — any future extension (new pattern kinds, new chat tools) must keep proposals user-gated and report tool failures verbatim.
**How to apply:** when adding pattern kinds, extend `extractPatterns` (pure, tested in tests/e2e/growthmind-phase5.e2e.test.ts) and keep adjustments within ±0.2; when adding chat write tools, route through the audit wrapper and register in the DECLARED list.
