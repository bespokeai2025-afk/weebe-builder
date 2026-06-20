---
name: WBAH leads sync duplicate explosion
description: Why the WBAH leads table accumulates ~100x duplicate rows; the dedup silently breaks past 1000 rows.
---

The WBAH leads sync (`upsertLeadsRows` in wbah-leads-sync-tick.ts) does a MANUAL dedup:
fetch existing webespoke_enterprise leads -> build byExternalId/byPhone maps -> insert
unmatched, update matched. The "fetch existing" select has NO pagination, so PostgREST
caps it at 1000 rows (`db-max-rows` default = 1000). Once the table exceeds 1000 rows,
almost no incoming record matches -> every 5-min sync re-inserts all ~1555 records as NEW.

Observed live (June 2026): 159,819 rows in `leads` for only 1,555 real after-call leads
(~100x), nearly all stuck at the original status "qualified" because updates almost never
fired. The created-in-last-95-min slice did show the new classifier working (~1,200
not_connected), proving the classification logic is correct — it's just buried under stale
duplicates.

**Why:** any "read all existing rows, dedup in JS" pattern against a Supabase/PostgREST
table silently truncates at 1000 rows and stops matching once the table grows past the cap.

**How to apply:** real fix = match only against the incoming IDs (store wbah_external_id in
a real indexed column + true Postgres upsert with a unique constraint), OR paginate the
existing fetch — PLUS a one-time cleanup. `runWbahFullResync()` already exists: it deletes
ALL webespoke_enterprise leads then re-inserts the ~1555 fresh (DESTRUCTIVE on a live table
— get explicit consent before running). The same trap applies to upsertContactRows
(data_records) and any other fetch-all-then-dedup path here.
