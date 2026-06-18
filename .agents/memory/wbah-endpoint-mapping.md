---
name: WBAH endpoint mapping
description: Definitive mapping of WeeBespoke API endpoints to WEBEE pages for the webuyanyhouse workspace
---

## Confirmed endpoint purposes (webuyanyhouse workspace)

| Endpoint | Purpose | Count | Page |
|---|---|---|---|
| `POST /call-output-data/get-user-history` | **Real completed call log** | 10,149 | Calls page |
| `GET /call-output-data/get-userCall-lead` | **Analyzed leads** (event=call_analyzed) | 1,201 | Contacts / Qualified |
| `GET /call-output-data/get-all-calldata` | CRM contacts-to-call (callId=null for most) | 609 | Dashboard metric only |
| `GET /call-output-data/get-call-count` | Dashboard scalars (totalCall, successCounts, etc.) | scalar | Dashboard |
| `GET /crm-data/get-crm-data` | Raw CRM upload (name + mobile_number only) | 3,720 | CRM admin |
| `GET /call-output-data/all` | 404 — does not exist | — | — |

## get-user-history specifics

- **Method**: POST with `{ currentPage: N }` body
- **pageSize**: hardcoded to 10 regardless of any limit/pageSize param in body
- **totalPages**: 1,015 (computed from totalItems÷pageSize; API-reported value unreliable)
- **Fields**: snake_case — `call_id`, `customer_name`, `to_number`, `duration_ms`, `recording_url`, `transcript`, `sentiment_analysis`, `call_status`, `disconnection_reason`, `end_reason`, `call_updatedat`, `call_appointment_date`, `call_appointment_time`, `call_booking_status`, `call_calendly_booking_url`

## normaliseWbahCall handles both sources

The function handles both snake_case (get-user-history) and camelCase (get-userCall-lead) transparently via `??` chains (e.g. `r.call_id ?? r._id ?? r.id`). No changes needed in calls.tsx field accesses.

## Pagination safety pattern in listWbahCalls

1. Fetch pages 1 & 2 in parallel
2. Compare `call_id` of first record on each page — if same, pagination stalled → warn and use page1 only
3. Fetch remaining pages in batches of 20
4. Deduplicate by `call_id` as final safety net

**Why:** The probe never tested `{ currentPage: 2 }` for this POST endpoint; the pattern guards against a broken pagination key without exposing duplicate records.
