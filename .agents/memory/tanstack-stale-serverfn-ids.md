---
name: TanStack Start stale server-fn IDs
description: After a server restart, browser tabs have stale server function IDs that cause HTML error pages
---

## Rule
After any code change that causes the Vite dev server to restart (HMR reload of a server module), the browser's in-memory TanStack Start server function references become stale. Calling them fails with:
```
Error: Invalid server function ID: eyJ...
```
TanStack Start returns its HTML "This page didn't load" error page instead of a JSON response. The client receives this HTML as the error body, and any `catch (e)` block that does `e.message` will contain raw HTML — which then renders as escaped HTML in the UI.

## Symptoms
- Server logs show "Invalid server function ID" errors
- UI shows "Generation failed" + `<!doctype html>...` content
- No `[your-provider]` log lines appear (the server fn never actually ran)

## Fix
**User must hard-refresh** (`Ctrl+Shift+R` / `Cmd+Shift+R`) in the preview pane after any server restart before interacting with the app.

**Why:** Server function IDs are compiled into the client bundle. When the server reloads a module, IDs may change. The browser still uses the old IDs from the pre-restart bundle.

**How to apply:** When debugging "Generation failed" + HTML errors, check server logs first. If "Invalid server function ID" appears with no actual provider log lines, the issue is a stale browser — not the API or server logic.

Update (2026-07-16): the inline preload-error reload script alone is NOT enough — the root route errorComponent catches stale-build errors (chunk 404s, "Invalid server function", HTML-instead-of-JSON) before the script helps. Fix: the error boundary itself must pattern-match stale-build errors and hard-reload once (sessionStorage timestamp guard), and "Try again" must be a full location.reload(), never router.invalidate()+reset() (re-runs the same stale code).

## Error boundary must be hook-free
Root/route errorComponents render in error-recovery contexts where React hooks can be invalid ("Invalid hook call") — a useEffect-based auto-reload never fires and the user stays stuck on the error screen. Pattern: no hooks; read sessionStorage guard in render body and `setTimeout(() => location.reload())`. Applied in __root.tsx ErrorComponent and qualified.tsx fallback.
