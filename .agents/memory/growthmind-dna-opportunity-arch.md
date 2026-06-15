---
name: GrowthMind DNA + Opportunity Engine architecture
description: 6-table schema, server fn patterns, and bridge extension for Business DNA and Opportunity Engine features
---

## Migration
File: `supabase/migrations/GROWTHMIND_DNA_OPPORTUNITY_MIGRATION.sql`
Tables: growthmind_business_dna, growthmind_opportunities, growthmind_value_points,
growthmind_strategies, growthmind_campaign_drafts, growthmind_generation_audit
- All require manual apply in Supabase SQL Editor
- Trigger `trg_seed_growthmind_defaults` auto-creates DNA row for new workspaces

## Server fn patterns
- All new fns use `.middleware([requireSupabaseAuth]).inputValidator(...)` — NOT `.validator()`
- No-input fns (getBusinessDna, getOpportunities, getCurrentValuePoint, runOpportunityEngine) called as `fn()` not `fn({ data: {} })`
- AI generation fns log to `growthmind_generation_audit` on every call

## Key exports
- `formatDnaAsContext(dna)` — converts DNA row to AI prompt context string
- `computeDnaCompletionScore(dna)` → `{ score, total, pct, missing[], grade }` — no `filled` field; use `missing.length` for UI
- `runOpportunityEngine()` — POST, no input, stores results in growthmind_opportunities

## Executive bridge extension
`buildGrowthMindExecutiveSummary` in executive-bridge.server.ts now:
- Queries DNA + value point + stored opportunities in the same Promise.all batch (always `.catch()`)
- Merges stored opps into topOpportunities (urgency-sorted, capped at 6)
- DNA completion < 50% appended to missingMarketingAssets
- Headline includes current value point summary

## Content Studio DNA injection
`buildContentPrompt` accepts optional DNA fields (dnaUsp, dnaOffer, dnaIcp, dnaBrandVoice, dnaCompliance, dnaCurrentVp) injected as "Business DNA" system block. `generateContent` server fn fetches DNA + value point in parallel alongside existing workspace/SEO/competitor queries.

**Why:** DNA context significantly improves specificity of AI-generated content without requiring any changes to the brief or user flow — it's transparent enrichment.
