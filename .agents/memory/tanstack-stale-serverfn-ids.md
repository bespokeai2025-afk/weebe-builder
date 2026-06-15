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
