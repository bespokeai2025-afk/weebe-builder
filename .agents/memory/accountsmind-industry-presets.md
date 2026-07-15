---
name: AccountsMind industry presets
description: How workspace industry + deterministic dashboard presets work and the safety rules around applying them
---

# AccountsMind industry presets

- Workspace industry lives in `workspace_settings.industry` (text, preset key). Presets are
  code-owned in `industry-presets.shared.ts` and may only reference NON-SENSITIVE
  `METRIC_REGISTRY` keys; the apply path re-filters against the registry anyway
  (defence-in-depth) so a preset can never make a billing/cost metric client-visible.
- **Why:** AccountsMind rows are client-visible; sensitive metrics (costs) must never be
  exposed via a preset shortcut that bypasses the AI-draft scrubber.
- **How to apply:** preset apply REPLACES the dashboard — archive live stat/widget rows whose
  keys aren't in the preset, then write preset rows through the same `versionedInsert`
  archive+version chain as SystemMind draft activation (exported as
  `versionedInsertConfigRow`). Never insert config rows directly.
- Permission gate: no fitting ActionKey exists — user-facing apply uses `resolvePermissions`
  (fail-closed) and requires `legacyRole` owner|admin; admin-side industry set uses
  `requirePlatformAdmin`. workspace_id always from auth context, never client input.
- The setup assistant (`generateAccountsMindConfigDraftServer`) seeds its prompt with the
  workspace's industry preset as a best-effort block — must never throw/block generation.
- Setting industry also write-through-fills a blank `growthmind_business_dna.industry`
  (label, not key) so GrowthMind stays consistent; never overwrite a non-blank DNA industry.
