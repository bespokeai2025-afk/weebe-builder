---
name: Reseller & white-label hierarchy
description: Durable rules for the parent/child workspace reseller model — capacity gating, isolation, branding resolution, and DB traps.
---

# Reseller & white-label hierarchy

- Capacity = package `maxChildAccounts` + active `extra_child_account` addon quantity; resolution must **fail closed to 0** on any error, and child creation does a post-insert re-check with rollback to survive races.
  - **Why:** entitlement caps are billing-relevant — must never fail open.
  - **How to apply:** any new surface that creates/counts child accounts must reuse the shared usage/capacity helpers, not re-derive limits.
- Children never inherit reseller/white-label powers, and `legacy_full` explicitly excludes the reseller/white-label feature keys so legacy/WBAH workspaces don't silently become resellers. Keep that exclusion when adding feature keys meant to be sold separately.
- All child-account reads/writes are strictly parent-scoped (requireOwnClient-style check before any mutation); sibling resellers must never see each other's clients. Children stay ordinary workspaces so Master Admin tooling sees them for free.
- Child branding resolves: client-row custom > inherit parent white-label settings > WEBEE default. Feature-gated white-label fields (custom domain, hide branding) are only applied when the caller verified those feature keys — the upsert takes explicit allow flags.
- Suspend works by flipping the child's subscription status (entitlements degrade automatically); remember to invalidate the child's entitlements cache and keep client-row/relationship/subscription states consistent (compensate/rollback on partial write failure — supabase builders don't throw).
- DB traps: `workspace_addons.addon_name` is NOT NULL; `workspace_white_label_settings` has no `id` column (PK = workspace_id).
- Billing provider integration deliberately out of scope: billing mode is an internal marker only.
