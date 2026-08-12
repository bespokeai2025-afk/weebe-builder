---
name: Google Ads write executor
description: Durable rules for real Google Ads mutations via the Marketing Action Engine — version sunset trap, negative-keyword policy, honest partial/terminal states.
---

# Google Ads write executor — durable rules

- **API version sunset trap:** Google silently blocks sunset API versions with `UNSUPPORTED_VERSION` (v21 died Aug 2026; default moved to v23, override via `GOOGLE_ADS_API_VERSION`). When GAds calls suddenly 400, check version sunset FIRST — and verify with the validate-only write probe (empty results on validateOnly = pass), never a real mutation.
- **Negative-keyword policy:** only terms classified IRRELEVANT under the four-way policy (relevant / irrelevant / uncertain / high_value_discovery) may become recommended or applied negatives. High cost with no conversions maps to *uncertain* — cost alone never justifies exclusion. Every considered term is appended to the permanent decision log (server-write-only, member-read, keep-forever by design).
- **Honest multi-step mutations:** a two-step change (e.g. create new keyword + pause old) that fails at step 2 must first attempt a compensating removal; if that also fails, report confirmed+error and make verify() require BOTH steps so a partial state can never reach "verified".
- **Linked-record honesty:** any record that links to a marketing action (via `marketing_action_id`) must be synced on EVERY terminal outcome — including pre-execution failures (stale autonomy, protected target, guardrail change, missing executor, approval-insert failure). An engine `not_allowed` submission means nothing is queued → the linked request is a manual *draft*, never "submitted".

- **Rollback verifiers must prove the compensating mutation:** removal/revert verifies parse the criterion resource name (`.../adGroupCriteria/{parent}~{critId}`) and read back absence; never return verified without a read-back.
**Why:** external ad-spend writes must never fake success, strand a real mutation, or exclude revenue-bearing search terms.
**How to apply:** new GAds action types get execute + independent verify + rollback builder, stay off the autopilot allowlist by default, and any new record linking to marketing actions must hook the terminal-status sync.
