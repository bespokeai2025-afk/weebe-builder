---
name: Cursor/GitHub repo is a snapshot of this project
description: How to handle "replace all code with my GitHub repo" requests for this project
---

The user's Cursor/GitHub repo `bespokeai2025-afk/weebe-builder` (main) was created as a byte-identical export of this Replit project's source (verified July 8 2026 via full-tree `diff -rq`).

**Rule:** when the user asks to "replace the code with the GitHub repo", diff the trees FIRST — the correct move has been a tiny dependency sync, not a destructive reset.

**Why:** the repo start commit contained every feature and fix already present here; the only real deltas were TanStack version pins in package.json + bun.lock. A hard reset would have risked Replit-side preserved files (.replit, .agents/, .local/, attached_assets) for zero gain.

**How to apply:** clone to /tmp, `diff -rq` excluding .git/node_modules/.local/.agents/attached_assets/build artifacts, report drift, then sync only the differing files. Secrets/deployment are platform-level and unaffected by code changes. Note: `npm run build` exceeds the 2-min shell cap — run it via a registered validation command instead (and clear it after, or it wires itself into the Run button's parallel group).
