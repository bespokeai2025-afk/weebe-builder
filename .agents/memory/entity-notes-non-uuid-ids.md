---
name: entity_notes non-UUID entity ids
description: entity_notes.entity_id must be TEXT, not UUID — many derived/synced rows use synthetic string ids.
---

# Notes can attach to rows whose id isn't a real UUID

Several parts of the platform synthesize non-UUID string ids for rows that don't
have (or don't reuse) a local UUID primary key — e.g. WBAH-derived
leads/contacts/calls, and CRM-only booked contacts built as `` `crm:${digits}` ``
or `` `wbah:${id}` `` composites. Any UI that lets a user attach a note to "this
row" may hand that synthetic id straight through as the notes `entityId`.

**Why:** `entity_notes.entity_id` was originally `UUID NOT NULL`, and the
`addEntityNote`/`listEntityNotes`/`deleteEntityNote` server functions validated
`entityId` with `z.string().uuid()`. Both layers silently broke — the toast said
"Failed to save note" — for every row whose id wasn't a real UUID, i.e. anywhere
those synthetic ids appear (found first in the Pipeline drawer, but the same
`entityId` param is shared by every notes call site across the app).

**How to apply:** keep `entity_notes.entity_id` as `TEXT` (not `UUID`), and keep
its Zod validator as a plain non-empty string (`z.string().min(1).max(300)`),
never `.uuid()`. Before adding `.uuid()` to any validator whose value might come
from a WBAH/synced/derived data source, check whether that source ever produces
a composite/prefixed string id instead of a table's real UUID primary key.
