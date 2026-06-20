---
name: WBAH after-call lead classification signals
description: How to derive lead status/sentiment from the WeeBespoke after-call endpoint, given its real (degenerate) data shape.
---

The after-call source is `GET /call-output-data/get-userCall-lead` (paginated 50/page,
~1555 items for WBAH). It returns lead-centric call output joined with CRM data:
`callStatus, sentimentAnalysis, endReason, disconnectionReason, booking_status,
appointment_date/time, calendly_booking_url, transcript, recordingUrl, lead_id, …`.

**The trap (live-verified):** on this account the obvious status fields are degenerate —
`callStatus` is **100% "ended"**, and `sentimentAnalysis` is only **neutral (~93%) / positive
(~3%), NEVER negative**. The real call outcome lives in **`endReason`**
(`user_hangup` ~45%, `voicemail_reached` ~37%, `inactivity` ~13%, `agent_hangup`) and in
`booking_status` (`success` ~33) / appointment / calendly fields.

**Rule:** derive `leads.status` from endReason/booking, NOT from callStatus/sentiment alone.
A no-human-reached call (`voicemail_reached` / `inactivity` / `no_answer`) must be
`not_connected`, and this check MUST run *before* the positive/neutral→qualified branch —
otherwise voicemails with neutral sentiment (the majority) all collapse to "qualified".

**Why:** the original `classifyStatus` returned "qualified" for any ended+positive/neutral
call before ever checking voicemail, and only inspected `disconnectionReason` (not
`endReason`), so ~786/1555 voicemail/dead-air leads were mis-counted as qualified.

**How to apply:** two `buildLeadRow` copies share this logic — `wbah-leads-sync-tick.ts`
(dev plugin, 30-min) and `wbah.functions.ts` (server fn). Keep them in lockstep.
`wbah-category-sync.ts::classifyLead` already does this correctly (voicemail→tried_to_contact,
negative→disqualified, booked→rebooking) into the separate `wbah_*` tables.

**Disqualified is not derivable from this endpoint for this dataset** (0 negative sentiment,
no disqualified flag). It comes from the WeeBespoke filter-master codes
(`/leadfiltermaster/get-leadfiltermaster`) consumed by the category sync, not from
get-userCall-lead. The Qualified page/dashboard KPI intentionally use `sentiment='positive'`
(~48), not `status='qualified'`.
