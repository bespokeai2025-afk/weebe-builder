---
name: Cursor/GitHub repo sync procedure
description: How to handle "deploy my GitHub repo changes" requests for this project
---

The user develops in Cursor and pushes to GitHub repo `bespokeai2025-afk/weebe-builder` (main), then asks to sync/deploy here. The repo started as an export of this project and now diverges with each push.

**Rule:** always diff the trees FIRST, then sync only the deltas — never hard reset or bulk-replace.

**Why:** a hard reset would destroy Replit-side preserved files (.replit, .agents/, .local/, attached_assets) and any Replit-only fixes. Deltas have ranged from tiny (dep pins) to substantial (~38 WBAH files in the July 2026 push).

**How to apply:** clone to /tmp, `diff -rq` excluding .git/node_modules/.local/.agents/attached_assets/build artifacts, report drift, sync only differing/new files. Check the repo's package-lock.json before adopting it — Cursor pushes have shipped a stale lock that didn't satisfy the repo's own package.json pins; keep the regenerated one if so. New repo migrations may already be applied (user runs them from Cursor side) — probe the table via service-role REST before flagging. Secrets/deployment settings are platform-level and unaffected. Note: `npm run build` exceeds the 2-min shell cap — run via a registered validation command (clear it after, or it wires into the Run button).
