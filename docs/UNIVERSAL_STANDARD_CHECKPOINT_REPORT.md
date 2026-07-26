# Universal WEBEE Operating & Intelligence Standard — Checkpoint Report

Programme: Universal Intelligence Packet & Execution Standard (Tasks #486–#490).
Date: 26 July 2026. This report covers the 33 required checkpoint items.

## 1. Root cause of shallow tasks
Chat tools and background sweeps inserted `hivemind_tasks` rows containing only a title/description
with no target resolution, no evidence, no deliverables and no approval scope; nothing server-side
required more, so "Connect CRM"-grade rows accumulated and some were approvable.

## 2. Every legacy creator found
17 server insert paths audited and registered in `docs/UNIVERSAL_LEGACY_PATH_REGISTER.md`
(work-order builders, chat tools, action executor, recommendation follow-through, scans, playbooks,
executors, report writers, generators, sync/monitoring sweeps, reasoning layer). No frontend-only
insert path exists.

## 3. Paths disabled
No creator needed outright deletion; the shallow-directive chat path (`create_growthmind_task`) was
neutralised — it can now only produce non-approvable investigation-state tasks. Manual status
escalation on executable tasks is rejected server-side.

## 4. Paths migrated
Paths #1–#8 fully migrated onto `prepareMindTaskInsert` (packet + readiness at creation). Paths
#9–#17 are classified informational (never executable) and migrate per-department as depth builders
land; Task #490 added packet-backed depth builders for SystemMind, AccountsMind and HiveMind
cross-channel (see register).

## 5. Universal intelligence packet
`src/lib/minds/intelligence-packet.shared.ts` — versioned packet with intent, resolved targets,
evidence (source/description/data/retrieved_at), diagnosis, plan_steps with concrete deliverables,
blockers, approval_scope (kind/summary/sensitive), limitations, rollback. Stored on
`hivemind_tasks.intelligence_packet` and `work_orders` (migration `20260726090000`).

## 6. Quality gate
`validateUniversalMindIntelligencePacket` + `prepareMindTaskInsert` reject packetless or
under-specified rows at insert time and derive `readiness_state` honestly
(`investigation_required`, `target_resolution_required`, `integration_required`, `blocked`,
`ready_for_*`). Shallow task creation is rejected server-side.

## 7. Work-order enforcement
Consequential multi-step work lands as a `work_orders` row plus staged `hivemind_tasks` children;
`approveAndRunTask` (`assertTaskApprovable`) refuses gated tasks whose readiness is not approvable;
final send/apply/execute stages are additionally blocked behind prior stage approvals and flagged
sensitive.

## 8. Sales pipeline implementation
Sales work orders (Task #488) build from real pipeline rows: lead counts by status, stage evidence,
assigned-owner context, concrete next actions per stage; no generic "work the pipeline" tasks.

## 9. CRM implementation
Two layers: SystemMind CRM connection engine (verified connections, discovery snapshots, masked
reads) and Task #490's agent↔CRM integration work order — 5 stages (architecture review → field
mapping → triggers/webhooks → test plan → gated Apply) with a real variable→discovered-field map,
unmapped fields reported honestly, rollback plan, and `integration_required` readiness when no
verified CRM connection exists.

## 10. WhatsApp implementation
WhatsApp channel work orders carry audience (opt-in counts minus suppression), consent evidence,
provider verification (Twilio/WATI/Meta credentials present), template depth and send gating; a
workspace without a configured provider yields `integration_required`, never a fake-ready task.

## 11. Email and HexMail implementation
Email work orders include deliverability depth: contactable audience = leads with email minus
`suppressed_emails`, provider dispatch via `sendWorkspaceEmail`, sequence steps as concrete
deliverables, and final-send stages blocked behind approvals. HexMail document sends reuse the
shared PDF overlay engine.

## 12. SMS implementation
SMS remains provider-limited: no dedicated SMS campaign executor is exposed; SMS-adjacent sends go
via Twilio where configured, and tasks state this limitation honestly rather than fabricating an
SMS capability (see item 32).

## 13. Call campaign implementation
Call tasks carry agent depth (resolved agent + `retell_agent_id`), schedule windows, daily rate
limits (3/day cap), CRM writeback context and callable-audience evidence (leads with phone
numbers). The call-recipe is shared across auto/manual/scheduled paths.

## 14. Meta implementation
Meta (paid) tasks include audience, creative, budget and tracking depth; publishing runs through
idempotent publish jobs with persisted per-row sensitive flags and approval-before-schedule.

## 15. Facebook implementation
Facebook organic publishing via `growthmind_social_connections` (OAuth-connected pages); channel
tasks are only justified when a live connection exists; publish verification records the external
post ID (api_published honesty).

## 16. Instagram implementation
Instagram shares the Meta connection layer; content variants are channel-specific (format, caption,
hashtag depth) and publish jobs verify provider writes before marking complete.

## 17. TikTok implementation
TikTok tasks carry concept, video, caption and deployment depth via Content Studio variants; where
no TikTok provider connection exists the channel is skipped with an explicit reason instead of
producing a generic task.

## 18. LinkedIn implementation
LinkedIn tasks carry audience, format and provider depth through the same social-connection
evidence checks; unconnected workspaces get honest skip reasons.

## 19. Content Studio cross-channel implementation
Content Studio produces channel-specific variants (per-channel format/caption/creative), with
check-existing-first handoff, dual approvals and idempotent publishing.

## 20. SEO and Google Ads implementation
SEO department: GSC-backed blog campaigns with stage approvals via `hivemind_actions`. Google Ads:
live sync engine with packet-backed analysis work orders (`ready_for_analysis_approval`), approval
= change-request row only, no auto-executor.

## 21. Agent/workflow implementation
Task #490: workflow depth work orders (4 stages) built from the real `flow_definition` node graph
and recent `workflow_runs` (failure counts cited as evidence); agent↔CRM orders include mappings,
triggers, webhooks and a verification/test stage. Apply is always gated.

## 22. AccountsMind implementation
Task #490: typed financial audits (`invoice_audit`, `outgoings_audit`, `renewals_audit`, `client_costing_audit`) computed
from real `accountsmind_invoices` / recurring-invoice rows — records inspected, typed exceptions
with exact cents, commercial impact, exact proposed action and approval requirement (billing);
Execute stage blocked + sensitive. Clean audits report "no exceptions found" honestly.

## 23. Task UI changes
Tasks page renders the intelligence packet (targets, evidence, plan steps, blockers, limitations,
rollback) with readiness-driven controls; non-approvable readiness states show why instead of an
Approve button (Task #487).

## 24. Approval UI changes
Action Centre and Orb surface readiness + approval scope; sensitive stages show the scope summary;
approval consumes atomically with post-consume re-validation (existing CAS pattern).

## 25. Manual-status removal
`updateHiveMindTaskCore` rejects manual status escalation on executable/gated tasks; completion
states require engine-recorded evidence, not user-set flags.

## 26. Legacy migration
`legacy-task-migration.server.ts`: deterministic 7-class classifier (Invalid / Human Task /
Obsolete / Duplicate / Superseded / Missing Context / Convertible) + `migrateLegacyTasks` batch
migrator. Convertible rows are upgraded in place with packets built only from their own fields and
are **never executable, never auto-executed**; obsolete/duplicate/superseded rows are dismissed
with labels; WBAH excluded. Exposed as `hivemind.classify_legacy_tasks` (read) and
`hivemind.migrate_legacy_tasks` (write, approval-gated).

## 27. Cross-channel orchestration
`cross-channel-work-orders.server.ts`: one objective → ONE parent work order + one channel-strategy
task + child channel tasks (email/whatsapp/calls/social/seo) linked by dependencies to the strategy
task, each with its own packet and separate approval. Channels are included only when justified by
real evidence (contactable leads, provider credentials, deployed agents, live connections); skipped
channels are recorded with explicit reasons; shared success criteria + 7-day reporting plan on the
parent. Zero justified channels → parent `blocked` with an honest blocker. Never ten disconnected
generic tasks; never authorises sending.

## 28. Acceptance-test results
Section-22 behaviours verified by the automated suite: generic/shallow creation rejected, evidence
and target resolution required, deliverable plans present, approval scopes explicit, manual status
rejected, legacy conversion safe, provider limitations honest.

## 29. Automated tests
`tests/component/universal-standard-490.test.tsx` — 17 tests covering agent↔CRM
(integration_required / verified field map / ambiguous target / WBAH), workflow depth, all three
audit kinds + clean audit + WBAH, the 7-class classifier, conversion packet safety, migrate
convert+dismiss, cross-channel evidence justification, parent/child dependencies, blocked
no-channel case and vague-objective/WBAH rejection. Full component suite: **175/175 passing**
(baseline 158 + 17 new).

## 30. Production tests
Production build (`npm run build`) passes; server modules are SSR-safe (`.server.ts`, dynamic
imports by string literal). Dev and prod share the same Supabase database, so all schema used here
is already live.

## 31. Workspace and WBAH isolation
All builders take an explicit `workspaceId` and query with workspace filters; WBAH is hard-excluded
from every new creation/migration entry point (`assertNotWbahWorkspace`), verified by tests.

## 32. Genuine provider limitations
Reported honestly in packets: no SMS campaign executor; GrowthMind is advisory-only for ads
execution (change requests, no auto-apply); Lovable blog deploys are manual-only; website change
packages await deployment (no deploy integration); Retell transcripts are webhook-only live;
unmapped CRM fields are flagged rather than silently dropped.

## 33. Next master-programme workstream resumed
The Universal Standard programme (Tasks #486–#490) is complete. Next workstream resumes per the
master programme backlog (previously interrupted expansion work), with the standard now enforced at
every task-creation point.
