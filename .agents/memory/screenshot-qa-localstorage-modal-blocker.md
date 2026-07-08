---
name: Screenshot QA blocked by localStorage-gated modals
description: Why the app_preview screenshot tool can get permanently stuck behind an onboarding/tour modal, and how to tell that apart from a real data/loading bug.
---

The legacy onboarding tour (`useOnboarding.ts`, key `webee_onboarding_v1`) and other first-run
modals are gated purely by browser `localStorage`, not by server/DB state. The `screenshot`
tool's `app_preview` renders in a fresh browser context each call, so `localStorage` never
persists across screenshots — a workspace with `onboardingState.path !== "grow"` will show the
"Welcome to Webee" tour on *every single screenshot*, permanently blocking visual QA of the page
behind it, with no query param or DB bypass available (server-side `workspace_onboarding.dismissed`
can be `true` while the modal still shows, because it's a different, purely client-side gate).

**Why:** Wasted significant time treating "page stuck at Loading 0%" as a suspected regression
from unrelated code changes, when the real blocker was an opaque modal rendered on top, and the
underlying page may have been fine (or blocked by a separate, also-unrelated issue like a slow
external API call for a CRM-synced test workspace).

**How to apply:** If an `app_preview` screenshot shows a "Welcome"/tour/walkthrough modal instead
of the page content, don't chase it as a bug — first rule out that it's simply the localStorage-gated
tour re-appearing because the sandboxed browser has no persisted localStorage. Fall back to
code review + direct read-only DB queries (via a small `node -e` script using
`VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the shell env — NOT the code_execution
sandbox, which does not expose `process.env` for these) to verify the underlying feature/data
without needing a clean screenshot.
