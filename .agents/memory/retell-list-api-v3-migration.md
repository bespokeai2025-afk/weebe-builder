---
name: Retell list-API v2/v3 migration
description: Deprecated Retell list endpoints replaced July 2026; new predicate filter grammar and pagination quirks
---

Retell deprecated GET /list-agents, GET /list-chat-agents, POST /v2/list-calls, GET /list-phone-numbers.
Replacements: POST /v2/list-agents, POST /v3/list-calls, GET /v2/list-phone-numbers — all paged via
`items[]` + `pagination_key` + `has_more` (no pagination_key_version).

**Rules for any new Retell list usage:**
- Always go through the shared helpers in `src/lib/providers/retell/list.server.ts` — never hand-roll fetches.
- Filter grammar is structured predicates, NOT the old arrays/thresholds:
  - channel: `{type:"string", op:"eq", value:"voice"}`
  - id lists: `{type:"string", op:"in", value:[...]}`; enum-ish fields (call_status etc.): `{type:"enum", op:"in", value:[...]}`
  - timestamps: `{type:"range", op:"bt", value:[lo,hi]}` or `{type:"number", op:"ge"|"le", value:n}`
  - `toV3FilterCriteria()` translates legacy shapes; callers can keep passing old-style filter_criteria to the helpers.
- **Live API quirk:** past the last real page the API can keep returning `has_more:true` with recycling cursors —
  paging loops must dedupe by natural id and stop when a page adds nothing new (helper already does this).
- Page failure must THROW (no silent partial sync); retry only 429/5xx; dedupe calls by call_id.
- **Dedup-key trap:** call records ALSO carry agent_id — the paging dedup key must check call_id BEFORE
  agent_id or a whole day of calls collapses to one row per agent (407 calls → 2). Regression test:
  tests/component/retell-list-pagination.test.tsx.

**Why:** silent partial syncs previously masked missing calls; the cursor-recycle quirk would otherwise burn
50 requests per listing or loop forever.
**How to apply:** any future Retell endpoint additions or SDK swaps — verify filter shapes against the live API
(error messages spell out the schema) before assuming docs are right.
