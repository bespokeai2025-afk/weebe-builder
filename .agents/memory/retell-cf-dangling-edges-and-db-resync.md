---
name: Retell CF dangling edges & DB ground-truth resync
description: How to safely patch a live Retell conversation flow in place and resync the DB's flow_data/settings/variables from it afterward.
---

## Rule
When editing a Retell agent/conversation-flow that's already deployed and taking real calls, prefer direct
Retell REST `GET` → edit JSON → `PATCH` over any in-app deploy/clone pipeline. Strip the same
READONLY_KEYS the app's own `retell.functions.ts` strips (conversation_flow_id, agent_id, version,
version_title, is_published, last_modification_timestamp, base_version, published_version, channel,
llm_id, response_engine_id) before PATCHing, and always re-`GET` after every `PATCH` to confirm Retell
accepted the change (e.g. enum types on `extract_dynamic_variables` nodes round-trip fine, but silent
truncation/coercion is possible and only visible via a fresh GET).

**Why:** Any in-app "Deploy"/"Go Live" pipeline can overwrite or wipe the live flow (it wasn't built for
surgical edits). Direct REST PATCH bypasses the DB and deploy code entirely, so it's the only safe way to
fix a live flow without touching real WEBEE traffic.

## Dangling edges are a real, silent bug class
Every node's edges/else_edge must have a `destination_node_id`. An edge with a transition condition but no
destination is easy to introduce (leftover from flow editing) and makes any call that triggers it stall
silently — Retell just waits with no further transition. After any CF edit, walk every node's
`edges`/`edge`/`else_edge` and assert every one has a non-null `destination_node_id`. Route orphaned
conditions to the nearest semantically-matching existing node (e.g. a generic "wants to book" condition
found dangling on an unrelated topic node should point at the flow's canonical booking-entry node, not a
new node).

## How to apply
1. Fix the live CF via direct PATCH first (ground truth), verify via GET, confirm zero dangling edges.
2. Mirror the same fixed CF body (post-stripKeys) onto the builder-tier conversation_flow_id via the same
   PATCH pattern — same Retell account/key, so this is safe and keeps builder/live in sync.
3. Mirror `post_call_analysis_data`/`post_call_analysis_model` from the live agent onto the builder agent
   the same way.
4. Resync the DB `agents` row (`flow_data`, `settings.rawAgent`, `settings.rawConversationFlow`,
   `variables`) by running `src/lib/builder/import-conversation-flow.ts`'s `importAgentJson` logic (it has
   only type-only imports, so it can be ported to plain JS and run standalone against the combined
   live-agent + live-CF JSON) — then overlay platform-only settings fields (agentId/conversationFlowId
   must stay the builder-tier IDs, deployedRetellAgentId/deployedConversationFlowId stay the live-tier IDs,
   dashboardAgentType/qualify/booking/company fields aren't present in Retell JSON at all and must be
   preserved from the old DB row) before writing back.
5. Post-call variable → lead field mappings live in `settings.qualify.postCallMappings` /
   `settings.leadGenSettings.postCallMappings` as `{ [retellVariableName]: targetField }`, where
   `targetField` starting with `meta.` writes into `leads.meta` JSON and anything else writes directly to
   a `leads` column (see `applyCustomPostCallData` in `src/lib/lead-gen/lead-intelligence.server.ts`).
