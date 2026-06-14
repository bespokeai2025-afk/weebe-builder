---
name: GrowthMind Content Calendar + Growth Scheduler
description: Schema, architecture, and key decisions for the two new GrowthMind pages at /growthmind/content-calendar and /growthmind/growth-scheduler
---

## Tables (migration 20260703000000_growthmind_content_calendar.sql)
- `growthmind_content_calendar` — main calendar with content_type, status, campaign_id, series_id, plan_id
- `growthmind_growth_campaigns` — campaign groupings (SEO, Meta, Google, Brand, etc.)
- `growthmind_content_series` — recurring series with cadence/day_of_week
- `growthmind_scheduled_content` — published tracking (external_url, reach/impressions/clicks)
- `growthmind_marketing_tasks` — task engine with task_type, priority, due_date, plan_id
- `growthmind_growth_plans` — growth scheduler plan config + generated_summary

**Why:** Separate tables for campaigns vs plans avoids ambiguity; `plan_id` FK on calendar+tasks links generated content back to its parent plan.

## generateGrowthPlan server fn
- Bulk-inserts calendar entries + tasks in one call using WEEK_TEMPLATES per plan type (30/60/90/annual)
- GPT-4o-mini generates per-item titles based on businessType/industry/offer; falls back to FALLBACK_TITLES per content type
- Writes `generated_at` + `generated_summary` back to the plan row
- Invalidates `growthmind-calendar` query key in addition to tasks

**How to apply:** Any new plan type needs a new entry in WEEK_TEMPLATES in `growthmind.growth-scheduler.ts`.

## HiveMind scanner additions (hivemind.tasks.ts)
Four new findings added to scanGrowthMind():
- `gm_no_content_this_week` — no calendar entries in next 7 days
- `gm_content_drafts_pending` — items still in Draft status this week
- `gm_overdue_tasks` — pending tasks past their due_date
- `gm_no_growth_plan` / `gm_plan_not_generated` — no active plan or plan not yet generated

## getMarketingReadiness
Queries growthmind_seo_sites, growthmind_growth_campaigns (existing tables) + growthmind_content_calendar + growthmind_marketing_tasks. Returns contentScore/campaignScore/seoScore/taskScore + stats object.
