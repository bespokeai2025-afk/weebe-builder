---
name: WBAH Disqualified tab derivation
description: Why the WBAH People → Disqualified tab/KPI is derived from wbah_calls negative sentiment, not from the lead/CRM APIs or wbah_categorized_leads.
---

# WBAH Disqualified tab derivation

The WBAH People → **Disqualified** sub-tab and its KPI card are derived **live from
the `wbah_calls` table** where `sentiment='negative'`, deduplicated to one row per
contact (most-recent negative call, `order by started_at desc` then first-seen
phone). `listWbahCategorizedLeads` branches on `category==="disqualified"` to return
these rows in the same contract the UI's `mapWbahCatRow` already consumes;
tried_to_contact / rebooking still read `wbah_categorized_leads`.

**Why:** No WeeBespoke API exposes a per-lead "Disqualified" filter status.
- `get-userCall-lead` (the only working lead endpoint) returns ONLY Neutral/Positive
  sentiment — never Negative — and its `leadStatus` query param is ignored.
- `get-crm-data` returns only `{name, mobile_number}` (no status), param also ignored.
- `/dashboard/*` and `get-user-history` exist but the WeeBespoke account is a single
  active session, so probing them from a script races the running app's background
  syncs → intermittent "Authentication failed". Don't rely on them from scripts.
The source BeSpoke People page shows a **"Negative"** KPI, so disqualified == negative
sentiment is the correct, evidence-backed mapping. `wbah_calls` (synced every 5 min)
already carries the rich fields the source shows: sentiment, disconnection_reason,
end_reason, call_status, duration, recording_url, transcript, booking_*.

**How to apply:** Counts won't match old source screenshots because the dataset grows
live (negative ~3.8% of contacts holds steady). If negative calls ever grow past low
thousands, push the dedup/pagination into SQL (and select transcript lazily) instead
of the current fetch-all-then-paginate-in-memory approach.
