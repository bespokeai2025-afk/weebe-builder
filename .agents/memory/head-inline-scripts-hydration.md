---
name: Inline head scripts & hydration
description: Why bootstrap scripts must be an external async src file, never inline <script> tags anywhere in the React-rendered <head>
---

# No inline <script> tags in the React-rendered <head> — use external async src

- **Rule:** bootstrap logic (theme init, error reporter, stale-build reload, SW cleanup) lives in
  `public/bootstrap.js`, referenced from the root route `head()` as
  `scripts: [{ src: "/bootstrap.js?v=N", async: true }]`. Never add inline `scripts: [{ children: ... }]`
  entries and never render raw `<script>` JSX in the shell `<head>`.
- **Why:** the Replit dev preview and browser extensions inject extra `<script>` tags into the served
  `<head>`. React 19 hydrates inline scripts POSITIONALLY (only `async src` scripts are hoistable
  resources matched by URL), so injected tags pair against the first inline script, hydration fails,
  and the recovery render surfaced "Invalid hook call" on every page. Moving inline snippets into the
  `head()` `scripts` config (the previous fix) was NOT enough — they were still positional.
- **How to apply:** new bootstrap snippets go into `public/bootstrap.js` (bump the `?v=` query when
  editing so cached browsers refetch). Because the script is async, dark mode is guaranteed pre-paint
  by rendering `<html class="dark">` (the default) in `RootShell`; the script only removes the class
  for light-mode users. `suppressHydrationWarning` on `<html>` tolerates the class difference.

## False "app crashed" alerts from recovered hydration errors (July 2026)
- React auto-recovers hydration mismatches, but the client-error reporter POSTing them to
  /api/monitoring/client-error produced `[client-error]` server-log lines that repeatedly triggered
  platform "runtime error / crashed" alerts while the app was healthy.
- Rule: crash reporting (bootstrap.js reporter + reportClientError in __root.tsx) must skip messages
  matching /Hydration failed|error while hydrating|hydration mismatch|Invalid hook call/i.
  All other errors still report. If a real persistent hydration bug is suspected, look at the
  browser console directly, not the monitoring endpoint.
