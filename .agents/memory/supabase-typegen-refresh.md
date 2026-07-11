---
name: Supabase types regeneration
description: How to regenerate src/integrations/supabase/types.ts from the live DB and verify the refresh safely
---

# Regenerating Supabase types from the live database

The generated types file goes stale as manual migrations are applied. To refresh it:

- Use the Management API typegen endpoint (no CLI login needed):
  `GET https://api.supabase.com/v1/projects/{ref}/types/typescript?included_schemas=public`
  with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Response is JSON `{ types: "..." }` —
  write `types` verbatim to `src/integrations/supabase/types.ts`.
- **Why:** local migration files can lie about column names (e.g. a migration said `received_at`
  but the live column is `created_at`); the live DB is the only ground truth.

**Verifying the refresh (this repo does NOT typecheck clean):**
- The project has hundreds of pre-existing `tsc --noEmit` errors (typecheck is not part of the
  vite build). To find errors *introduced* by a types refresh, diff error **file:line locations**
  (strip messages) between a baseline run (old types) and a new run — error message text embeds
  the Database type dump, so message-level diffs show hundreds of false "new" errors.
- `tsc --noEmit` takes ~2min and exceeds the 120s bash session limit; detached processes are
  killed when the session ends. Run it via a temporary console **workflow** writing output to a
  file (`npx tsc --noEmit > /tmp/out 2>&1; echo DONE_EXIT=$? >> /tmp/out; sleep 3600`), then poll
  the file. Default/6GB heap can OOM (exit 134/137) under load — 3GB heap worked.

**How to apply:** after applying any manual migration batch, re-run the typegen fetch and
location-diff check; fix only genuinely new error locations.
