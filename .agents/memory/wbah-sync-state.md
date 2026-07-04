---
name: WBAH unified sync_state
description: Descriptive-only per-workspace/per-module sync tracking; why WBAH must never gain background/auto sync, and the upsert trick that preserves last-success timestamps.
---

# WBAH unified sync_state

A per-workspace, per-module `sync_state` table records the OUTCOME of syncs
(status, last-success time, created/updated/skipped counts). It is a
bookkeeping/observability layer, surfaced as a "Sync History" panel on the WBAH
admin page and readable via a membership/admin-gated GET server fn.

## Rules
- **Recording is descriptive-only and best-effort.** The recorder never throws
  and never contacts an external API — it only writes the result of a sync that
  already ran on demand. Wire it AFTER the sync completes, wrapped so a
  bookkeeping failure can never break the sync.
- **Never add background/automatic/scheduled sync for WBAH.** WeeBespoke's
  Enterprise API is single-active-session; any auto-login/background sync kicks
  the human admin out of WeeBespoke. This is why the 3 background WBAH sync
  plugins are disabled. Sync stays on-demand/manual only.
- **Reads must be tenant-gated in code.** The read fn uses the service-role
  client (bypasses RLS), so it must check platform-admin OR workspace-membership
  against the *target* workspace before returning rows. Table RLS is SELECT-only
  for members; writes go through service-role.

**Why:** the user explicitly chose "keep WBAH on-demand only + safe additive
improvements" precisely because a daily/background sync would re-break the
single-session integration. The value added was visibility into past syncs, not
new sync behavior.

## Upsert-preserves-omitted-columns trick
supabase-js `.upsert(row, { onConflict })` → PostgREST `merge-duplicates` →
`ON CONFLICT (...) DO UPDATE SET` for ONLY the columns present in the payload.
So on an error record we OMIT `last_successful_sync_at`; the previous success
timestamp is left untouched. A unique INDEX (not constraint) is a valid arbiter
for `ON CONFLICT (cols)`.

**How to apply:** any future "last successful X / last attempted X" pattern can
use one upsert row and simply omit the success column on failure — don't
read-modify-write.
