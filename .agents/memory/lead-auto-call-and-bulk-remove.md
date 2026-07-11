---
name: Lead auto-call automation + bulk remove
description: How new-lead auto-calling is wired in, its rate-limit caveat, and where bulk lead removal lives.
---

# Lead auto-call automation

`triggerAutoCallForNewLead()` (`src/lib/qualification/auto-call.server.ts`) is a
never-throwing core function, gated per-workspace by
`workspace_settings.lead_auto_call_enabled` + `lead_auto_call_agent_id`. It
mirrors the manual/scheduled call-placing logic in
`startQualificationCallsForLeads` / `scheduleQualificationCalls`
(`leads.functions.ts`) exactly: same Retell key resolution priority (client's
own `retell_workspace_id` always wins over the platform key), same
3-calls-per-phone-per-UTC-day cap, same `calls` row shape.

It's hooked (awaited, not fire-and-forget — safe since it never throws) into
every lead-creation path: `upsertLead`, `processWebformSubmission` (only when
a brand-new lead is created, not on dedup/update), and the Developer API's
`POST /api/v1/leads` and `POST /api/v1/contacts`. It is intentionally **not**
hooked into `/api/v1/campaigns`'s auto-create-lead-by-phone branch — that
endpoint already enrols the lead into a campaign that will call it on its own
cadence, so adding an auto-call there risks a double-dial.

**Why:** keeps auto-call, manual "Qualify Leads", and scheduled campaigns from
fighting each other or duplicating logic — one call-placing recipe, three
trigger points.

**Caveat:** the 3/day cap is a rate limit, not a dedupe lock — it does NOT
prevent an auto-call and a same-day manual/scheduled call from both dialing
the same lead. This is pre-existing behavior shared by all three paths, not a
new gap. If a future task needs strict "only ever call once" semantics, that
requires a real lock (e.g. a `calling` status check before placing rather
than only after) not just the count cap.

## Bulk remove leads

`removeLeads` server fn (`leads.functions.ts`) deletes by id list, always
scoped to `workspace_id` (the older single-lead `deleteLead` does NOT scope by
workspace_id — a pre-existing gap, left as-is). Wired into
`leads.index.tsx`'s selection toolbar next to "Qualify N Leads", gated the
same way (`tab === "leads" && !isWbah`), with a confirm dialog.

## Developer API v1 SUPABASE_URL fallback

`v1-auth.middleware.ts` and each `src/routes/api/v1/*.ts` route builds its own
Supabase client from `process.env.SUPABASE_URL` with **no fallback** to
`VITE_SUPABASE_URL` (unlike `client.server.ts`, which does
`SUPABASE_URL || VITE_SUPABASE_URL`). In this dev environment only
`VITE_SUPABASE_URL` is set, so the whole Developer API v1 surface silently
can't connect. Fixed the fallback in `v1-auth.middleware.ts`, `leads.ts`,
`contacts.ts`, `campaigns.ts` (the files touched for auto-call), but ~17 other
`api/v1/*.ts` route files still have the un-fallback'd version — worth a
dedicated cleanup pass if the Developer API needs to work in dev.
