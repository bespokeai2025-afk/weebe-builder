---
name: SystemMind Build Workspace
description: Iterative Replit-style agent/workflow builder — versioning, apply/risk gating, provenance, usage billing.
---

# SystemMind Build Workspace

Route `/systemmind/build` (?session/?workflow/?agent search params). Core in
`src/lib/systemmind/build-workspace.server.ts` + `.functions.ts`; UI in
`SystemMindBuildWorkspacePage.tsx`. Migration `20260812000000` (applied).

## Durable rules
- **Immutable versions**: every prompt/restore creates a NEW version row; never mutate
  `generated_config` of an existing version. Restore = new draft version copying old config.
- **Apply risk gate**: `classifyConfigRisk` on apply — high-risk NEVER auto-applies; it goes
  `systemmind_generated_actions` → `submitDraftForApprovalServer` (HiveMind approval) and the
  hub dispatcher calls `activateBuildWorkspaceApplyKind`. Re-validate config server-side at
  apply time; don't trust what sat in the DB.
- **Apply targets one workflow row per session**: linked_workflow_id (edit mode) else the row
  a prior version of the same session applied into, else fresh INSERT with `status:"inactive"`
  (never auto-activate). Provenance cols on `workspace_workflows`: `source =
  "systemmind_build"`, `source_build_session_id`, `source_build_version`.
- **markBuildVersionDeployed requires status "applied"** — client callers must gate on the
  provenance status before calling; wire it best-effort (try/catch) so bookkeeping can never
  break a deploy/go-live flow. Wired in: Build Workspace "Apply & Go Live" (reuses existing
  goLiveAgent) and RetellDeployDialog's 3 deploy paths (retell/elevenlabs/hyperstream).
- **Usage billing**: every generate/simulate/apply records into `systemmind_usage_events`
  (tokens, elapsed_ms, tool calls, provider cost, customer charge at the then-current
  `cost_engine_systemmind` row). Pricing is row-versioned (`is_current`); past events keep
  their billed rates. Allowance model: month is free only if ALL configured allowances
  (runs/seconds/tokens) are within limits; otherwise raw charge × overage_multiplier.
  Aggregation happens at AccountsMind read time, not at event-write time.
- **Admin surfaces**: AccountsMind → SystemMind (`/admin/accounts/systemmind`) = per-workspace
  usage + platform pricing editor (requirePlatformAdmin on the server fns; routes themselves
  are ungated like all AccountsMind siblings — that is the established pattern).
- **Pricing editor client trap**: seed the form only on `pricingQ.isSuccess` — seeding on
  "not loading" includes the error state and an admin Save would zero live platform pricing.
