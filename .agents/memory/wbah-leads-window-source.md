---
name: WBAH /leads window data source
description: Why the dedicated /leads "Positive/Neutral Leads" window for WBAH derives from wbah_calls, not the leads table.
---

The dedicated `/leads` window (route `_authenticated/leads.index.tsx`) for the WBAH
workspace shows ONLY already-called contacts whose latest call came back
positive/neutral, deduped to one row per contact, newest-first. Its data source is
**`wbah_calls`** (via the no-input GET server fn `listWbahPositiveNeutralLeads`),
NOT the `leads` table.

**Why:** The WBAH `leads` table is bloated (~262k rows, only positive/neutral
sentiment present) and has **zero `meta.last_called_at`** values, so it cannot be
sorted by "last called" and does not match the BeSpoke screenshots. `wbah_calls`
is the source of truth: it has real `started_at` per call, so deduping by phone
(keeping the latest) yields ~1.5k positive/neutral called contacts that sort
correctly. `listLeads` enriches from the `calls` table (empty for WBAH), so WBAH
call fields must come from the row's own columns/`meta`, never that enrichment.

**How to apply:** The server fn returns the /leads row contract (top-level lead
fields + a `meta` blob with last_called_at/call_status/duration_ms/recording_url/
appointment_*/booking_status/end_reason/disconnection_reason) so the existing WBAH
table renderer works unchanged. In `leads.index.tsx`, `isWbah`/`wsResolved` state
is declared before `leadsQ`; `leadsQ` branches its queryFn on `isWbah`, keys on
`isWbah`, and is `enabled: wsResolved` so the wrong source never fetches first.
This window is deliberately distinct from the `/data` People section (DQ/TTC/
Rebooking + its "Leads" sub-tab) — do not couple them. For WBAH, the Qualify
button is hidden and quick-filters are reduced to Positive/Neutral (rows have no
`status`); the Notes button keys on the `wbah_calls` id (self-consistent).
