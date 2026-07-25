---
name: Inline head scripts & hydration
description: Why bootstrap scripts must go through the root route head() config, not raw JSX in <head>
---

# Inline <head> scripts must render via head() config

- **Rule:** never render inline `<script dangerouslySetInnerHTML>` tags as raw JSX inside `RootShell`'s `<head>`. Put them in the root route's `head()` config under `scripts: [{ children: ... }]` so `HeadContent` renders them.
- **Why:** the Replit dev preview (and browser extensions) inject extra `<script>` tags into the served HTML `<head>`. React hydrates raw JSX head children positionally, pairs our first inline script against the injected one, hydration fails, and the recovery render crashes ("Invalid hook call" runtime error on every page).
- **How to apply:** any new bootstrap snippet (theme init, error reporter, etc.) goes into the `scripts` array of the root route `head()`, keeping theme init first so dark mode still applies before paint.

## False "app crashed" alerts from recovered hydration errors (July 2026)
- React auto-recovers hydration mismatches (regenerates tree client-side), but the client-error
  reporter POSTing them to /api/monitoring/client-error produced `[client-error]` server-log lines
  that repeatedly triggered platform "runtime error / crashed" alerts while the app was healthy.
- Rule: crash reporting (errorReportScript + reportClientError in __root.tsx) must skip messages
  matching /Hydration failed|error while hydrating|hydration mismatch|Invalid hook call/i.
  All other errors still report. If a real persistent hydration bug is suspected, look at the
  browser console directly, not the monitoring endpoint.
