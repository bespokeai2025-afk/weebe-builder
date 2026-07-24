---
name: GrowthMind script performance intelligence
description: Architecture and constraints of the call-script performance analysis feature (30d aggregation, WBAH routing, advisory-only recommendations).
---

- Aggregation reads the workspace's real call tables with WBAH routing: WBAH workspaces use `wbah_calls` (qualification proxy = positive sentiment, tz Europe/London), standard workspaces use `calls` (`call_successful`) with bookings counted from `calendar_bookings`. Fetches must page past PostgREST's 1000-row cap.
- Results snapshot into `growthmind_script_analysis` (members-read RLS, server-write-only) with a 6h cache; prune queries must stay workspace-filtered because they run on the admin client.
- AI pattern extraction is a single model call over ≤18 truncated transcripts with deterministic JSON parse + clamping — never per-transcript calls.
- Recommendations are advisory-only: `generateScriptRecommendation` creates a draft `growthmind_campaign_proposals` row + pending `hivemind_actions` row and NEVER touches production agents. `hivemind_actions` has `action_payload`/`proposed_by`/`sensitive` columns but NO priority/source/metadata columns.
- Executive-bridge events (conversion risk, objection patterns) publish never-throw and only at ≥50 analysed calls to avoid noise on small samples.
- **Why:** keeps the drafts-until-approval platform convention and prevents a script-analysis failure or small-sample noise from cascading into executive events.
- **How to apply:** any future script/transcript analytics should reuse this WBAH routing + snapshot-cache + advisory-proposal pattern; e2e fixtures for `calls` require `to_number` NOT NULL.
