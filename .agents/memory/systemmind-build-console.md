---
name: SystemMind Build Console consolidation
description: One tabbed console at /systemmind/build replaced five Improve pages; embedded-prop pattern; wfTab param remap; setup-success learning hook.
---

# SystemMind Build Console

**Rule:** All SystemMind build/automation surfaces live inside the single console at `/systemmind/build` (tabs: build | workflows | drafts | automation | fix-plans). Do not re-add separate sidebar pages for these; add new build-related surfaces as console tabs.

**Why:** User explicitly wants one console for all build work; the old one-sidebar-item-per-feature sprawl was rejected.

**How to apply:**
- Existing page components were kept and given an `embedded?: boolean` prop that swaps `SystemMindShell` for a fragment — reuse that pattern when embedding a shell-wrapped page.
- Embedded pages must use `useSearch({ strict: false })`, never `useSearch({ from: <old route> })`.
- Param collision trap: the console owns the `tab` search param. Workflow Intelligence's internal tab was renamed to `wfTab`; the old `/systemmind/workflows?tab=X` redirect remaps `tab→wfTab` and keeps `health`. Any embedded page needing its own tab param must use a distinct name and be whitelisted in the build route's `validateSearch`.
- Deep-link params `session`/`agent`/`convert` always force the Build tab.
- Old routes (`workflows`, `workflow-drafts`, `automation`, `fix-plans`) are `beforeLoad` redirects — keep them so stale links/fixHrefs still work.
- Playbooks + Template Library are adminOnly (Intelligence group): templates/playbooks are SystemMind reference knowledge, never customer-browsable.

**Learning hook:** `activateSystemMindAutomation` (both kind-dispatch and legacy-workflow paths) fire-and-forgets `recordSetupSuccessLearning` (`src/lib/systemmind/systemmind-setup-learning.server.ts`), which upserts an `executive_documents` note (seed_key `setup_success:<kind>:<actionId>`) into the workspace's own `systemmind` KB. It must never block or throw into activation, and summaries must stay non-sensitive (no credentials).
