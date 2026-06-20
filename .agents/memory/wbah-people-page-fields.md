---
name: WBAH People page field & filter flow
description: How WBAH leads display fields, the Leads-vs-Calls status vocabulary split, and the Calls count badge actually work on the live People page.
---

# WBAH People page: fields, status buckets, calls badge

Three non-obvious constraints when touching the "We Buy Any House" (workspace slug
`webuyanyhouse`) People page (`data.tsx`) and its sync pipeline.

## 1. Lead display fields must be written in BOTH places
A field only shows on the Leads sub-tab if `buildLeadRow` (wbah-leads-sync-tick.ts)
writes it into `leads.meta` AND `listWbahLeadsForPeople` (wbah-workspace.server.ts)
reads it back. The WeeBespoke lead API records DO contain `startTimestamp`,
`transcript`, `recordingUrl`, `calendly_booking_url`, `agentName` — but they are
dropped unless explicitly mapped into meta.
**Why:** the two halves were written at different times and silently drift.
**How to apply:** when adding a Leads column, add it to the meta object in
`buildLeadRow` and to the row mapping in `listWbahLeadsForPeople`. The 5-min sync
tick overwrites each existing row's meta, so newly-added fields backfill on the
next tick (no manual migration). For an *immediate* value, fall back to a column
already in the DB (e.g. transcript falls back to `leads.call_summary`).

## 2. Leads and Calls use DIFFERENT status vocabularies
Leads carry the raw API status (`ended`, `need_to_call`, `not_connected`,
`call_analyzed`). `wbah_calls` rows carry a normalized status (`completed`,
`no_answer`, `failed`). A single cross-tab Status filter MUST normalize both
through a bucket helper (`wbahStatusKey`) — comparing raw strings will silently
match nothing on one of the two shapes.

## 3. Calls count badge — use a lightweight COUNT, never eager-load full rows
Calls live in the separate `wbah_calls` table (~11k rows, each with a full
transcript + call_summary). NEVER eager-load all rows just to populate the Calls
sub-tab badge — that multi-MB payload was the cause of the slow People page.
**Why:** the badge only needs a number; the full rows are a huge payload that
competes with and delays the default Leads view on mount.
**How to apply:** on People-tab mount fetch only the count via `listWbahCallsCount`
(`head:true` + `count:"exact"`, cached 2 min) into `wbahCallsCount`. Full rows
stay lazy — they load via the `wbahPeopleSubTab === "calls"` effect when the tab
is opened, and `handleFetchWbahCalls` then sets `wbahCallsCount = rows.length`.
Badge reads `(wbahCallsData.length || wbahCallsCount)`. `listWbahLeadsForPeople`
is cached 60s (safe: leads come from a 5-min background sync, page actions import
to CRM rather than mutating source lead rows).
