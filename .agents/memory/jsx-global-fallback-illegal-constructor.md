---
name: JSX global fallback → "Illegal constructor"
description: Unimported JSX component names that collide with browser globals crash at render with TypeError Illegal constructor; TypeScript does not catch it.
---

Rule: any capitalized JSX element whose identifier is not imported/defined silently resolves to a same-named browser global (e.g. `Lock` → Web Locks API, `History`, `Notification`, `Selection`). React then renders the native class and the page dies with `TypeError: Illegal constructor` — shown to users as "This page didn't load — Illegal constructor".

**Why:** WBAH prod crash on /qualified, /data, /dashboard was `<Lock>` used in app-sidebar's package-upgrade dialog without a lucide import. It only fired for accounts whose package locks sidebar items (dialog renders on locked-item click), so it looked data/account-specific and evaded static hunting. TypeScript passes because DOM lib declares the global class.

**How to apply:** when chasing "Illegal constructor", grep for lucide-ish icon names used in JSX but missing from the import block (Lock, History, Text, Image, Notification…). Verify with the client-error reporter (`/api/monitoring/client-error`, `[client-error]` lines in server logs) which captures uncaught render errors with stack — it works in dev too. Conditional/dialog-only renders are the usual hiding spot.
