---
name: GAds deep-analysis reports
description: Architecture and rules for GrowthMind's Google Ads deep-analysis reports (deep GAQL fetch, deterministic classification, advisory AI sections, persisted report + viewer).
---

# GrowthMind Google Ads deep-analysis reports

**Rule:** The GAds analysis work order produces a full evidence-based report, not just recommendations. Data path is strictly read-only against Google Ads (GAQL `search` only, never mutate). All AI output is advisory and must be grounded in the fetched rows; deterministic layers (keyword/search-term classification, negative candidates, change-request scaffolding) come from code, not the model.

**Why:** The user explicitly required "no invented stats" and honest sections — earlier shallow versions produced generic advice. Splitting deterministic (numbers, classifications) from AI (narrative, concepts, blueprints) keeps every figure traceable to a GAQL row.

**How to apply:**
- Fetch: `gads-deep-fetch.server.ts` — 12 GAQL sections in one pass (campaign settings/IS, daily/device/day-of-week, keywords + QS components, search terms, ads, conversion actions, ad groups).
- Build: `gads-deep-analysis.server.ts` `buildGadsDeepAnalysisReport()` — deterministic classifiers + SSRF-guarded landing-page snapshot + 6 `routeGenerate` AI calls (contentType `gads_deep_analysis`); per-section errors stored honestly in the sections JSONB, never fabricated.
- Persist: one row per run in `growthmind_gads_analysis_reports` (workspace RLS members-read; writes via admin client from the adapter). Adapter stores `report_id` in the hivemind action payload + artifacts + evidence.
- Surface: `gads-analysis-report.server.ts` server fns (by reportId or workOrderId) + `GadsAnalysisReportViewer` (12 tabs, CSV export, print/PDF) rendered on the work-order detail page.
- Verify stage re-reads the stored row and fails if <5 sections present — keep that gate when changing section names.
- Change requests are drafts requiring approval (approval levels per group); external Google Ads writes remain a blocked step by design (GrowthMind is advisory-only).
