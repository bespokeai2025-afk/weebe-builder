---
name: Inline head scripts & hydration
description: Why bootstrap scripts must go through the root route head() config, not raw JSX in <head>
---

# Inline <head> scripts must render via head() config

- **Rule:** never render inline `<script dangerouslySetInnerHTML>` tags as raw JSX inside `RootShell`'s `<head>`. Put them in the root route's `head()` config under `scripts: [{ children: ... }]` so `HeadContent` renders them.
- **Why:** the Replit dev preview (and browser extensions) inject extra `<script>` tags into the served HTML `<head>`. React hydrates raw JSX head children positionally, pairs our first inline script against the injected one, hydration fails, and the recovery render crashes ("Invalid hook call" runtime error on every page).
- **How to apply:** any new bootstrap snippet (theme init, error reporter, etc.) goes into the `scripts` array of the root route `head()`, keeping theme init first so dark mode still applies before paint.
