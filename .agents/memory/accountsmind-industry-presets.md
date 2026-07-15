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
- **How to apply:** preset apply REPLACES the dashboard atomically — a single
  service_role-only Postgres RPC `apply_accountsmind_industry_preset` (migration
  20260718000000, CREATE OR REPLACE, hooked into post-merge) archives non-preset live rows
  and versioned-inserts preset rows in ONE transaction. SystemMind draft activation is
  atomic too via its own RPC `activate_accountsmind_config_draft` (migration 20260719000000,
  archives ONLY same-key rows — never touches unrelated live config). Never insert config
  rows directly, and never add a row-by-row JS fallback (it would reintroduce half-applied
  dashboards).
  `workspace_settings.industry` is written only AFTER the RPC succeeds so a failed apply
  leaves workspace state fully untouched.
- Permission gate: no fitting ActionKey exists — user-facing apply uses `resolvePermissions`
  (fail-closed) and requires `legacyRole` owner|admin; admin-side industry set uses
  `requirePlatformAdmin`. workspace_id always from auth context, never client input.
- The setup assistant (`generateAccountsMindConfigDraftServer`) seeds its prompt with the
  workspace's industry preset as a best-effort block — must never throw/block generation.
- Setting industry also write-through-fills a blank `growthmind_business_dna.industry`
  (label, not key) so GrowthMind stays consistent; never overwrite a non-blank DNA industry.
