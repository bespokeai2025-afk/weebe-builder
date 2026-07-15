---
name: Access enforcement (package ∩ role ∩ override)
description: How effective access is resolved and enforced; guard conventions for server fns; UI lock/hide layer is non-authoritative.
---

# Access enforcement architecture

**Rule:** effective access = package feature caps ∩ role page level ∩ per-user override, resolved by
`resolveEffectiveAccess` (entitlements.server). Fail-closed on any read error; owners are never
locked out by role/override (package caps still apply); denials audit to
`workspace_access_audit_logs`.

**Why:** UI-only gating was bypassable by calling server fns directly; enforcement must live in the
server guard, not the sidebar or route guard.

**How to apply:**
- Every sensitive server fn handler must call an entitlement guard first:
  `requirePageAccessEntitled(ws, user, pageKey, level)` or `requireActionAccess(ws, user, actionKey)`.
  SystemMind fns use the wrappers in `systemmind-access.server.ts` (view / edit / approval —
  approval = anything that goes live). Use string-literal dynamic imports inside handlers.
- Middleware auth (`requireSupabaseAuth`) alone is NOT enforcement — auth-only handlers were the
  main audit finding. When adding a new `*.functions.ts` fn, add the guard block; platform-admin-only
  fns (`requirePlatformAdmin`/`assertAdmin`) are exempt.
- Entitlements cached 30s per workspace; anything that changes subscription/overrides must call
  `invalidateEntitlementsCache(workspaceId)` (tests too, or they read stale packages).
- UI layer: `LockedRouteGuard` (ROUTE_PAGE_MAP/matchRouteKey in packages.shared.ts) shows lock
  screens and fails OPEN by design; sidebar hides `pageAccess === "hidden"` items. Never rely on it.
- WBAH workspace behavior intentionally unchanged.
