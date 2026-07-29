---
name: Retell phone-number agent binding
description: Retell deprecated single-agent phone fields; bindings must use the agents-array shape or writes 400 silently.
---

**Rule:** All Retell phone-number binding writes must use the `inbound_agents` / `outbound_agents` array shape (`[{ agent_id, weight }]`). The legacy `inbound_agent_id` / `outbound_agent_id` fields were deprecated 2026-03-31 and now return HTTP 400. Reads should accept both shapes (fallback to legacy fields).

**Why:** The AVA agent's configured number lost inbound routing because binding writes using the legacy fields started failing with 400 after the deprecation — outbound still worked (agent specified per call), so the fault was invisible until an inbound-call audit. Also note: an inbound binding can be pinned to a specific `agent_version`; an unversioned binding follows the latest published version.

**How to apply:** Any new code touching Retell `create-phone-number`, `import-phone-number`, or `update-phone-number` must use the array shape; when reading `list-phone-numbers`, resolve the bound agent from the array first, legacy field second. To unbind, send an empty array, not `null` legacy fields. The user-facing Agent Health page (`/agent-health`) surfaces missing inbound bindings as a Failed badge.
