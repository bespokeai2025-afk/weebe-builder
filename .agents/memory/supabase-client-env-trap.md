---
name: Client-side Supabase must use the canonical client (env-var trap)
description: Browser/client React code must import { supabase } from "@/integrations/supabase/client" — never hand-roll createClient(), because the client publishable key env var is VITE_SUPABASE_PUBLISHABLE_KEY, NOT VITE_SUPABASE_ANON_KEY.
---

# Client-side Supabase: use the canonical client, never a hand-rolled createClient

In any browser/client component, get Supabase via
`import { supabase } from "@/integrations/supabase/client"`. Do NOT call
`createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`
yourself.

**Why:** This project's client publishable key is exposed as
`VITE_SUPABASE_PUBLISHABLE_KEY` (see `src/integrations/supabase/client.ts`).
There is **no** `VITE_SUPABASE_ANON_KEY` in the client bundle, so a hand-rolled
`createClient(url, import.meta.env.VITE_SUPABASE_ANON_KEY!)` passes `undefined` as
the key and `@supabase/supabase-js` throws `Error: supabaseKey is required` at
construction time. If that happens inside a `useEffect`, React escalates it to the
route error boundary and the whole page renders "This page didn't load" — a total
page crash, not a silent failure. (This bit the `/contacts` route,
`src/routes/_authenticated/contacts.tsx`, for the WBAH workspace-detection effect.)

**How to apply:**
- New client code that needs Supabase auth/queries: import the shared `supabase`
  proxy and use it directly (it lazily constructs on first access with the right
  key + localStorage session). Pattern to copy: `data.tsx` workspace detection.
- Server code is different: it uses `process.env.SUPABASE_URL` /
  `process.env.SUPABASE_PUBLISHABLE_KEY` (or the service-role key for admin), via
  `@/integrations/supabase/client.server` or `supabaseAdmin`. Never the anon name.
- If you see `VITE_SUPABASE_ANON_KEY` referenced anywhere on the client, it is a
  bug — the correct name is `VITE_SUPABASE_PUBLISHABLE_KEY`.
