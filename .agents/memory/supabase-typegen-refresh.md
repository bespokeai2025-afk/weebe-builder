---
name: Supabase types regeneration
description: How to regenerate src/integrations/supabase/types.ts from the live DB and verify the refresh safely
---

# Regenerating Supabase types from the live database

The generated types file goes stale as manual migrations are applied. To refresh it:

- **Preferred: `node scripts/refresh-supabase-types.mjs`** — fetches live types and overwrites
  the file; `--check` exits 1 when stale (registered as the `schema-types-fresh` validation
  step). Run it after every migration apply.
- Under the hood it uses the Management API typegen endpoint (no CLI login needed):
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

**Common pre-existing error classes and fixes (from the 440→237 cleanup):**
- TanStack server-fn handlers whose return contains `unknown` / `Record<string, unknown>` fail
  the serializable-return validation with a huge truncated TS2345 on `.handler(...)` — type those
  values as `any` / `Record<string, any>` (or a concrete shape) instead of `unknown`.
- `NonNullable<typeof x>` inside an `if (!x)` block resolves to `never` (x is narrowed to null
  there) — use a named type alias instead.
- PostgrestBuilder has no `.catch`; use `.then(onOk, onErr)`.
- `Record<string, unknown>` is not assignable to a `Json` column — cast via
  `as import("@/integrations/supabase/types").Json`.
