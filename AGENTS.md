# AGENTS.md

## Cursor Cloud specific instructions

WEBEE / WebEspoke AI Builder is a single full-stack TypeScript app (TanStack Start + Vite,
React 19) backed by Supabase (Postgres + Auth). It is not a monorepo; everything runs from
one dev server. Standard scripts live in `package.json` (`dev`, `build`, `lint`, `typecheck`,
`test`, `format`).

### Running the app (dev)
- Start with `npm run dev`. The dev server binds to `http://0.0.0.0:5000` (see `vite.config.ts`,
  `strictPort: true`). The README's `localhost:3000` is outdated — the app is on port **5000**.
- Requires a `.env` (copy from `.env.example`). The Supabase client throws lazily only when first
  accessed if `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (and the `VITE_` equivalents) are unset,
  so the landing page can render without them but auth/dashboard cannot.
- The dev server also starts several in-process background scheduler plugins (campaign scheduler,
  video poller, provider health sweep, etc. — see `vite.config.ts`). This is normal; they log
  "ready" lines and are harmless without real provider credentials.

### Backend (Supabase)
- The app targets a **cloud** Supabase project by default (`supabase/config.toml` only has a
  `project_id`). For a self-contained local dev/E2E, run a local stack with the Supabase CLI +
  Docker (`supabase start`), then set `SUPABASE_URL` / `VITE_SUPABASE_URL` to `http://127.0.0.1:54321`
  and use the CLI-printed publishable + service-role keys in `.env`.
- The migration set does **not** apply cleanly to a from-scratch database. Known gotchas:
  - Duplicate migration version prefixes collide on `schema_migrations` PK: `20260608`, `20260612`,
    and `20260613` each have two files. A fresh `supabase start`/`db reset` fails until the second
    file in each pair is given a unique timestamp locally.
  - Many `*.sql` files in `supabase/migrations/` have **no timestamp prefix** (e.g.
    `CLIENT_API_PROBE_MIGRATION.sql`, `GROWTHMIND_*`, `SYSTEMMIND_*`). These are manual
    "run in the Supabase SQL editor" migrations and are ignored by the CLI, so tables they create
    (e.g. `client_api_connections`) won't exist. The timestamped migration
    `20260802000000_webee_api_engine.sql` depends on such a table and will fail from scratch.
  - Core auth/workspace/agents/leads schema (everything before `20260802000000`) applies cleanly,
    which is enough to log in, use the builder, and exercise most core flows.
- Login: `scripts/seed-admin.ts` creates the admin user with a **random** password (not the
  `admin123` the README mentions). For a known password, create a confirmed user via the
  service-role admin API (`auth.admin.createUser({ email, password, email_confirm: true })`), which
  auto-provisions the profile + workspace via a DB trigger.

### Docker-in-docker (only if standing up local Supabase)
- Docker 29 needs `fuse-overlayfs` storage driver AND `features.containerd-snapshotter: false` in
  `/etc/docker/daemon.json`, plus `iptables-legacy`, to work in this VM. The Supabase CLI ships as a
  `supabase` shim that requires `supabase-go` on PATH alongside it.

### Lint / typecheck / test — pre-existing noise (not your regressions)
- `npm run lint` reports tens of thousands of pre-existing errors (mostly `prettier/prettier` and
  `@typescript-eslint/no-explicit-any`). CI runs lint with `continue-on-error: true`.
- `npm run typecheck` fails with many pre-existing type errors (the repo even ships a captured
  `tsc_out2.txt`). Treat these as baseline unless your change adds new ones.
- `npm run test` (Vitest): the real unit tests pass, but `src/routes/api/v1/agents.test.ts` is an API
  route file mis-detected as a test and always fails with "No test suite found". A harmless
  "close timed out" teardown warning is also expected.
