---
name: WeeBespoke API response envelope
description: Every WeeBespoke (uat-api.webespokeai.com) list endpoint wraps its payload; how to extract the real array.
---

# WeeBespoke API response envelope

Every WeeBespoke AI list endpoint (campaigns, agents, crm-data, call-output-data,
dashboard, etc.) returns the SAME envelope:

```
{ result: true, statuscode: 200, message: "...", data: [ ...the rows... ] }
```

The low-level `aGet`/`authenticatedFetch` in `client.server.ts` parses the whole
HTTP body into `ApiResponse.data`. So after `const res = await api.wbahGetX(...)`,
`res.data` is the **envelope object**, and the array you want is `res.data.data`.

**Rule:** never do `Array.isArray(res.data) ? res.data : []` on a WeeBespoke list
response — `res.data` is the wrapper object, so that test is always false and you
silently get `[]`. Use an envelope-aware extractor that returns the first array
among `res.data` itself / `res.data.data` / `.result` / `.rows` / the named key.

**Why:** this exact bug made the WBAH Campaigns section show nothing — campaigns
(and the agents shown on them) never pulled through, even though the API returned
them. Agents happened to work because their extractor already checked `.data`.

**How to apply:**
- `getWbahCampaigns` (wbah-workspace.server.ts) uses `extractWbahArray()` for this.
- Confirmed real shapes (admin login `/admin/login`, then Bearer):
  - `/campaigns` → data rows have: id, name, status ("Active"), agent_id,
    lead_status, call_hour, call_minute, timezone, frequency ("Custom"),
    interval_days, isActive, voicemail_enabled, isDeleted, createdAt, updatedAt.
    Note: call_hour/call_minute (not call_time), frequency (not frequency_type),
    createdAt (not created_at), capitalised status — `normalizeWbahCampaign` maps these.
  - `/agent/get-list` → rows: agent_id, agent_name, webhook_url, is_active.
- You can probe the live API from the shell (creds are in the workspace env):
  `WEBESPOKE_ADMIN_EMAIL` + `WEBESPOKE_ADMIN_PASSWORD`, POST `/admin/login`, then
  GET with `Authorization: Bearer <token>`. Print only keys/counts — the rows
  contain real customer PII (names, phones, recording URLs); never log values or
  commit sample payloads.
