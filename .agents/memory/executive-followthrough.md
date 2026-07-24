---
name: Executive recommendation follow-through
description: How hivemind_recommendations trigger mode-gated pending actions and how outcomes reflect back.
---

- Follow-throughs from recommendations NEVER execute directly — they always insert `hivemind_actions` rows with status `pending` + `source_recommendation_id`; execution only via approveHiveMindAction (mode gate + entitlements + CAS + TOCTOU re-validation).
- Mode gating: observe = blocked entirely; recommend = non-internal mappings downgraded to `create_task`; assistant/operator = full mapping (engine auto-proposes for newly inserted recs, best-effort).
- Sensitive mappings keep `sensitive`/`sensitive_category` flags so they can never auto-execute regardless of mode.
- Payloads for high-risk mappings are built server-side from live data (e.g. stale_lead_backlog → create_followup_campaign with need_to_call leads >7d stale, cap 500, WBAH excluded); never trust client payloads.
- Outcome reflection: executed→completed, failed→failed, rejected→under_review; terminal recs (completed/dismissed/expired) never resurrected. Dedupe = one open linked action per rec.
- **Why:** keeps the "engine advises, humans approve" invariant consistent across all HiveMind surfaces.
- **How to apply:** any new recommendation→action mapping goes in mapFollowThrough in `src/lib/hivemind/executive-followthrough.server.ts`, must set sensitive flags via action-safety.shared and be covered in the follow-through e2e suite.
- Test-fixture trap: `leads` inserts need `full_name` (not `name`) and enum source values like `website_form` ("webform" is invalid).
