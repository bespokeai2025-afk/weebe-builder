---
name: Trend Anatomy & Adaptation engine
description: GrowthMind multimodal deep analysis + original adaptation briefs — storage choices, Gemini multimodal call shape, SSRF guard, blocking gates
---

# Trend Anatomy (deep video analysis) + Adaptation engine

- **Anatomy storage**: `growthmind_content_anatomy`, ONE row per (workspace_id, trend_item_id) — upsert with `onConflict: "workspace_id,trend_item_id"` (unique *index*, works with PostgREST upsert). RLS members SELECT-only; writes via service-role admin.
- **Adaptations reuse `growthmind_content_recommendations`** (no new table): payload JSONB carries the full brief + originality record + compliance verdict. Pass = status `recommended` (flows into the existing Content Studio handoff); blocked = status `failed` (enum has no `blocked`). **Why:** downstream Phase 4 approval/handoff work reads recommendations — a separate adaptations table would fork the lifecycle.
- **Gemini multimodal**: raw REST `generateContent` with parts — `file_data.file_uri` works for YouTube URLs directly (no upload); small direct video files go as `inline_data` base64 (≤15MB); otherwise metadata-only prompt flagged status `partial`. Text-only `geminiGenerate` in providers/ can't do this — separate call in `trend-anatomy.server.ts`.
- **SSRF guard is mandatory** on any fetch of `item.url` (untrusted, discovery-sourced): https only, DNS-resolve + reject private/reserved IPs, `redirect: "manual"` with re-validation per hop (max 3). Architect review failed the first version for missing this.
- **Blocking gates**: 5-gram word overlap vs source transcript >18% blocks; restricted-claims scan (≥70% keyword match per claim line from DNA restricted_claims/compliance_notes) blocks; unlicensed-audio signals only warn.
- **Caps/costs**: daily cap = `workspace_settings.growthmind_deep_analysis_daily_limit` (default 5), counted via `growthmind_discovery_runs` run_kind `deep_analysis` since UTC midnight; run_kind CHECK was extended to include `deep_analysis`/`adaptation` (migration 20260824000000, applied live).
