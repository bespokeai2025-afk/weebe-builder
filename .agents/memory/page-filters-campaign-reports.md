---
name: Page Saved Filters + Campaign Auto-Reports
description: Cross-page saved-filter engine and automatic campaign report system — datasets, report kinds, fix whitelist, WBAH exclusion.
---

# Page Saved Filters + Campaign Auto-Reports

- Saved page filters are one engine for 9 page keys; each page key maps to a dataset (leads / calls / campaigns / workspace_workflows) in a central registry (`PAGE_DATASETS` in the people-views filter engine). Adding a page = add a registry entry, never a new table.
- Filters are versioned + dry-runnable + audited, strictly read-only over page data. SystemMind drafts them via action kind `page_filter`; approval-first like all SystemMind automation.
- Campaign reports are written by lifecycle hooks (telephony functions) + per-run by the campaign executor. Report kinds: run_summary, no_eligible_leads, safety_blocked, provider_error, workflow_error. Failure reports create a HiveMind task with status "suggested".
- **Reports never mutate.** SystemMind `campaign_fix` drafts may ONLY patch schedule config (`__sched_v1__`): callTime/timezone/callFrequency("daily"|"custom")/intervalDays/campaignFilterId — never targets or status; re-validated at activation.
- The executor uses RELATIVE imports only (report-writer.shared.ts must keep zero `@/` imports) because it also runs outside Vite alias resolution.
- WBAH exclusion is enforced SERVER-SIDE (a tiny shared no-import exclusion module usable from vite-config-loaded code), not just by UI gating — the filters UI self-hides because the guarded server fns error/return empty for WBAH.
- Fix drafts revalidate their campaignFilterId again at activation (approval-time TOCTOU), not just at draft time; the SystemMind draft schema must never be broader than the filter engine's validator (engine is and-only logic).
- **Why:** spec hard-constraints — never break campaign execution, fixes need human approval, WBAH isolated.
- **How to apply:** any new page filter surface or report kind must go through the registry / report-writer, keep the fix whitelist closed, and keep WBAH gates.
