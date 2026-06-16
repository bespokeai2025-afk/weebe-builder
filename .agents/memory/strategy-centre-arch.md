---
name: GrowthMind Strategy Centre
description: Architecture of the Strategy Centre at /growthmind/strategy-centre — prompt engine routing, DB tables, HiveMind integration.
---

# GrowthMind Strategy Centre

## Tables (STRATEGY_CENTRE_MIGRATION.sql — apply manually)
- `growthmind_strategy_centre` — main strategy rows (13 types, 6-state status flow)
- `growthmind_strategy_assets` — per-engine generated drafts (FK → strategy_centre)
- `growthmind_strategy_tasks` — tasks created on approval (FK → strategy_centre)
- `growthmind_prompt_runs` — prompt engine execution log

## Server module split
- `prompt-command-router.server.ts` — pure routing logic (no DB), engine lists, prompt builder. `.server.ts` suffix = server-only; do NOT import values from client components.
- `growthmind.strategy-centre.ts` — all server fns + `getStrategyCentreSummary` plain async fn

## Strategy types → engine mapping
- 30/60/90-day: content_studio + seo (+ campaign_factory + video_studio for 90)
- seo_campaign: seo only
- meta_ads: campaign_factory + video_studio
- google_ads: campaign_factory + landing_page
- linkedin: campaign_factory + content_studio
- whatsapp_campaign: whatsapp only
- hexmail_campaign: hexmail only
- video_ad: video_studio only
- ai_calling_campaign: ai_calling only
- landing_page_campaign: landing_page only
- full_multi_channel: ALL 8 engines

## HiveMind integration
- `fetchFullPlatformData` includes `strategyCentre` summary (graceful import)
- Context string shows pending count + latest strategy details
- Scanner (`proposeActions`) finds `proposed_to_hivemind` rows → creates hivemind_actions
- `sendStrategyCentreToHiveMind` creates the hivemind_action; `approveStrategyCentre` marks it completed + creates strategy_tasks

**Why:** GrowthMind is advisory-only — no campaigns launch without HiveMind approval.
