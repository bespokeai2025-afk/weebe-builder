---
name: WBAH People tabs = need-to-be-called, split 3 ways (CRM-sourced)
description: All three WBAH People sub-tabs (Disqualified / Tried-To-Contact / Rebooking) are mutually-exclusive buckets of not-yet-booked contacts, derived live from the CRM get-all-calldata feed (NOT wbah_calls, NOT the lead APIs, NOT wbah_categorized_leads). Disqualified folds in not-yet-called contacts; the Leads sub-tab was removed.
---

# WBAH People tabs = "need to be called", split into 3 mutually-exclusive buckets

The WBAH `/data` People sub-tabs partition the **not-yet-booked** contact set into
THREE mutually-exclusive buckets — each contact appears in exactly one tab. Derived
live from the CRM `get-all-calldata` feed via `classifyWbahCrmContact` +
`getWbahCrmLoadedContacts` + `listWbahCrmLoadedCategory` in wbah-workspace.server.ts.
The handler is `listWbahCategorizedLeads`.

**Why this source changed (was `wbah_calls`, now `get-all-calldata`):**
`wbah_calls` only holds contacts that have *already been dialled* — it has no
not-yet-called ("need_to_call") rows and no per-contact CRM load date. The CRM
`get-all-calldata` feed is the ONLY source that carries both: not-yet-called
contacts (`callId === null` ⟺ `callStatus === "need_to_call"`) AND a per-record
load date (`createdAt`). The user explicitly wanted the buckets to include
not-yet-called contacts with a CRM load date, so the tabs now read this feed.

**Bucket rules (first match wins — ORDER MATTERS), on each CRM record:**
1. **Not called yet** (`!callId` or `callStatus === "need_to_call"`) → **Disqualified**.
   Per WBAH, need-to-call contacts live in the Disqualified tab alongside truly
   disqualified leads. Raw `callStatus` is preserved as `need_to_call` so the UI
   badge still distinguishes "Need To Call" from negative/disqualified.
2. **Disqualified** — `sentimentAnalysis = 'negative'`, or not-interested/reject/
   unsuitable/do-not-call/disqualif text in disconnection/end reason.
3. **Rebooking** — has an `appointment_date`, or rebook/reschedule/call-back/
   call-later/callback/pending text.
4. **Tried To Contact** — `callStatus` no_answer/not_connected/voicemail, or
   voicemail/no_input/dial_* reason. (reached attempt, never connected)
5. **Default → Rebooking** — reached (`ended`), neutral/positive, no booking yet.

**get-all-calldata pagination IS reliable** (unlike `get-user-history`, whose
`totalPages` is bogus — see webespokeapi-totalpages-bug). Live probe:
`{totalItems:1170, totalPages:24, pageSize:50}`. Still, the fetch guards with
`totalPages = max(api.totalPages, ceil(totalItems / pageSize))` so an unreliable
count can't silently under-fetch and drop contacts.

**Fetch / dedup / exclude (getWbahCrmLoadedContacts):**
- Fetch page 1, then pages 2..N in batches of 8 via `Promise.allSettled`.
- A failed page is retried once, then **throws** — counts must never be partial.
- Dedup by phone (`toNumber`), keeping the latest `createdAt` row per contact.
- Exclude already-booked (`booking_status === "success"`), classify the rest.
- Wrapped in `cacheWrap` (60s, key `webee:wbah-crm-contacts:<ws>`) so the 3 tabs +
  their count probes share one fetch. cacheWrap degrades gracefully when Redis is
  unconfigured (dev): `require("@upstash/redis")` fails in ESM, is caught, factory
  runs directly — benign, logged once per process.

**UI (`src/routes/_authenticated/data.tsx`):**
- Default sub-tab is now `"disqualified"` (the "Leads" sub-tab was **removed**).
- Row mapper adds `loadedAt = meta.crm_loaded_at ?? created_at`; a conditional
  **LOADED** column (only on category tabs, `isCat`) shows `fmtDate(loadedAt)`.
- The date filter (`wbahRowPasses`) falls back to `loadedAt` when a row has no
  `startTimestamp` (not-yet-called rows have none).
- KPI strip is rebased onto the 3 bucket counts: CRM Contacts (sum), Disqualified /
  Need to Call, Tried to Contact, Rebooking. Each uses `data.length || count`;
  `handleFetchWbahCategory` accumulates ALL pages (≤50×200), so once a tab loads,
  `data.length` is the true total (no cap) — counts (`limit:1` `.total`) are the
  pre-load fallback.

**How to apply:** Counts are live and grow — don't expect old screenshots to match.
If the user disputes bucket sizes, tweak the order/conditions in
`classifyWbahCrmContact`. Booked-exclusion judges by the contact's latest-loaded
row's `booking_status`, which is fine at this scale.
