---
name: Prod login "broken" — diagnose Supabase project health first
description: When production login breaks, rule out a paused/unhealthy Supabase project (PGRST002/503) before suspecting code, password, or the admin secrets.
---

When the published site's login "breaks," check the database platform layer BEFORE touching code:

**Signal:** a direct REST probe (`GET {VITE_SUPABASE_URL}/rest/v1/<table>` with the service-role
key) returns **HTTP 503 / `PGRST002` "Could not query the database for the schema cache. Retrying."**
This means the Supabase project's Postgres itself is paused/unhealthy — not a code or password bug.
It fails IDENTICALLY from dev and prod (same Supabase backend), and the workflow logs fill with
`Could not query the database for the schema cache` + `Webuyanyhouse workspace not found`.

**Common cause seen:** a Supabase **compute-size upgrade/resize** that got stuck (dashboard shows an
error banner; repeatedly clicking "Upgrade" queues conflicting ops and makes it worse). Resolution is
user-side: a clean **Restart project**, or a **Supabase support ticket** to clear the stuck compute op.
Once healthy, REST returns 200 and login works again.

**Login mechanism:** the app uses **Supabase Auth** (`signInWithPassword`). Verify end-to-end with
`POST {url}/auth/v1/token?grant_type=password` using the **publishable/anon** key as `apikey`. A
`400 Invalid login credentials` is GoTrue rejecting the email OR password (auth is up; creds are wrong).

**Secret trap:** the `WEBESPOKE_ADMIN_EMAIL` / `WEBESPOKE_ADMIN_PASSWORD` secrets do **NOT** correspond
to any real auth user — automated logins with them always 400. The real workspace owners use different
emails (find them by joining `workspaces.slug` → `workspace_members.user_id` → admin API user lookup).
Don't treat those secrets as valid login creds.

**Why:** during the outage the failure looked like a login bug, but auth/credentials were fine; the only
real blocker was the database being offline. Confirming project health first avoids chasing phantom
code/password fixes.
