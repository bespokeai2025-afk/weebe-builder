---
name: WeeBespoke API totalPages bug
description: The WeeBespoke API's pagination.totalPages field is incorrect — it reports a much smaller number than the true page count. Always compute from totalItems ÷ pageSize instead.
---

## The bug

The WeeBespoke `/call-output-data/get-all-calldata` (and likely other endpoints) returns a pagination object like:

```json
{ "totalItems": 10149, "totalPages": 13, "currentPage": 1, "pageSize": 50 }
```

`totalPages: 13` is wrong — `ceil(10149 / 50) = 203` pages. Trusting `totalPages` means `fetchAllPages` stops after page 13 and returns only ~609 records instead of all 10,149.

## The fix

In `extractTotalPages` (wbah-workspace.server.ts), **always** compute from `totalItems ÷ pageSize` first, and only fall back to the raw `totalPages` field if `totalItems` or `pageSize` is missing.

**Why:** The API value appears stale/wrong; the computed value matches the actual data volume visible in the WeeBespoke admin UI.

**How to apply:** Any time a new paginated WeeBespoke endpoint is added, ensure `fetchAllPages` is used (which calls `extractTotalPages`), and do NOT trust the raw `totalPages` field from the response.
