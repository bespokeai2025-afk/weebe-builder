---
name: WBAH endpoint mapping
description: Definitive mapping of WeeBespoke API endpoints to WEBEE pages for the webuyanyhouse workspace
---

## Confirmed endpoint purposes (webuyanyhouse workspace)

| Endpoint | Purpose | Count | Page |
|---|---|---|---|
| `POST /call-output-data/get-user-history` | **Real completed call log** | 10,149 | Calls page |
| `GET /call-output-data/get-userCall-lead` | **Analyzed leads** (event=call_analyzed) | **1,200** | /leads (Supabase sync) + /qualified (direct) |
| `GET /call-output-data/get-all-calldata` | CRM contacts-to-call (callId=null for most) | 609 | Dashboard metric only |
| `GET /call-output-data/get-call-count` | Dashboard scalars (totalCall, successCounts, etc.) | scalar | Dashboard |
| `GET /crm-data/get-crm-data` | Raw CRM upload (name + mobile_number only) | 3,720 | CRM admin |
| `GET /call-output-data/all` | 404 — does not exist | — | — |

## get-user-history pagination — CRITICAL

- **Pagination key**: URL query param `?currentPage=N` — NOT the POST body
- All body-based pagination keys are silently ignored (`page`, `pageNumber`, `pageNo`, `pageNum`, `offset`, `skip`, `currentPage` in body — all return the same first 10 records)
- `wbahGetUserHistoryPaged(page)` must POST to `/call-output-data/get-user-history?currentPage=${page}` with empty body `{}`
- **pageSize**: hardcoded to 10 regardless of any body param
- **totalPages**: 1,015 (10,149 ÷ 10); `totalItems=10149` confirmed accurate

**Why the previous run got only 5,620:** HMR fired mid-fetch, reloading the server fn. The auth token also had concurrent refresh collisions when 20 parallel requests hit 401 simultaneously. An uninterrupted run fetches all 10,149.

## get-userCall-lead pagination — CONFIRMED

- **Pagination key**: URL query param `?currentPage=N` on a GET request — WORKS
- **pageSize**: hardcoded to 50 (NOT 10 — that is `get-user-history`'s page size)
- **totalItems**: ~1,201 (live count; grows over time)
- **totalPages**: `Math.ceil(totalItems / pageSize)` — use actual `p1Records.length || 50`, never hardcode 10
- `wbahGetUserCallLeadPaged(page, gt, st)` = `GET /call-output-data/get-userCall-lead?currentPage=${page}`

**Bug fixed (wbah-leads-sync-tick.ts):** `fetchAllLeadRecords` was dividing by `10` instead of `50`, causing 121 pages to be fetched instead of 25. Pages 26-121 returned duplicate/empty data; 12 records with no external_id slipped through dedup → DB had 1212 instead of ~1201. Fix: use `p1Records.length || 50` as divisor + in-memory seenIds dedup. **After this fix, trigger Admin → WBAH → Full Resync to purge the 12 stale extras.**

## Token expiry handling — CONFIRMED

- WeeBespoke JWT tokens expire. Both accessToken and refreshToken can expire together.
- `authenticatedFetch` tries refresh token first, then `reloginFn` if provided — but `aGet`/`aPost` don't pass `reloginFn`.
- **Fix**: `ensureFreshToken()` in `wbah.functions.ts` re-logins via `POST /admin/login` with env-var creds (`WEBESPOKE_ADMIN_EMAIL` + `WEBESPOKE_ADMIN_PASSWORD`) and upserts the new token into `enterprise_integrations`. Call it at the start of any bulk sync operation.

## get-user-history field schema (snake_case)

`call_id`, `customer_name`, `to_number`, `duration_ms`, `recording_url`, `transcript`, `sentiment_analysis`, `call_status`, `disconnection_reason`, `end_reason`, `call_updatedat`, `call_appointment_date`, `call_appointment_time`, `call_booking_status`, `call_calendly_booking_url`

## normaliseWbahCall handles both sources

Handles both snake_case (get-user-history) and camelCase (get-userCall-lead) transparently via `??` chains. No changes needed in calls.tsx field accesses.

## Pagination safety pattern in listWbahCalls

1. Fetch pages 1 & 2 via `?currentPage=1` and `?currentPage=2`
2. Compare `call_id` of first record — if same, run key-discovery probe (tries `?page`, `?pageNumber`, `?pageNo`, `?offset` via `authenticatedFetch`)
3. Fetch remaining pages in parallel batches of 20
4. Log HTTP status + raw response on first empty batch for diagnostics
5. Stop early after first all-zero batch (server has no more data)
6. Deduplicate by `call_id` as final safety net

## /leads page architecture

- `/leads` (leads.index.tsx) shows Supabase `leads` table, filtered to the current workspace
- WBAH leads are populated via `adminSyncWebuyanyhouseLeads` → `fetchAllLeadRecords` → upserts into `leads` table
- `/qualified` (qualified.tsx) fetches WeeBespoke directly via `listWbahLeads` server fn
- After sync, `/leads` shows 1,200 records; sync must be re-triggered manually from Admin → WBAH → "Sync Leads"
