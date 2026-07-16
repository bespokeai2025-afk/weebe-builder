---
name: Package access & staff seats
description: How package-based feature gating, seat enforcement and per-user overrides work; traps when extending them.
---

# Package access & chargeable staff seats

- Effective access = role level ∩ package cap ∩ per-user override (`resolveEffectiveAccess` in `src/lib/packages/entitlements.server.ts`). Owners can never be overridden down; `noEntitlements()` still leaves settings/team_access/billing=manage as a safety valve so an owner can always fix billing.
- **Why:** fail-closed everywhere except the owner escape hatch — otherwise a lapsed subscription could permanently lock a workspace out of its own billing page.
- Code catalog (`PACKAGE_CATALOG` in `packages.shared.ts`) is the source of truth; the `package_definitions` DB table exists but is intentionally NOT seeded/read. Don't start reading it without seeding + sync strategy.
- Global `requireAction`/`requirePageAccess` in `permissions.server.ts` are package-aware via dynamic import (string literal — prod Rollup trap). New gated features get package enforcement for free if they use these; do NOT add parallel bespoke checks.
- Resource limits (agents/workflows/campaigns) enforced only at creation via `requireResourceCapacity`; counting failures log + allow (don't hard-block on a count error). Seat usage counts active members + pending invites; `requireStaffSeat` gates createInvite AND acceptInvite (invite could be created before a downgrade).
- Entitlements have a 30s in-process cache — tests/scripts changing subscriptions must wait or bypass; UI locks are advisory only (sidebar fails open), backend is the enforcement layer.
- Backfill: all pre-existing workspaces were assigned `legacy_full` (everything unlocked) so nothing broke at rollout — new signups get a 14-day `trial` via `provisionWorkspacePackage` (idempotent) wired into both workspace-provision paths.
