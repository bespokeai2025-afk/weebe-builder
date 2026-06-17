---
name: Onboarding V2 Architecture
description: Customer Onboarding V2 system — path selection, DB schema, component layout, knowledge tier rules.
---

## System Overview

Three-layer onboarding:
1. **OnboardingWelcome** — path-selection modal (first login only, shown when `workspace_onboarding.path IS NULL AND dismissed = false`)
2. **OnboardingChecklist** — floating progress widget (shown after path is set)
3. **GatedOnboardingTour** — legacy agent-builder 15-step tour (suppressed for "grow"-only path users)

## DB Schema

Table `workspace_onboarding` (PK = `workspace_id`):
- `path` — `'agent_builder' | 'grow' | 'both'` (null until chosen)
- `dismissed` — user closed modal without choosing
- `completed` — all onboarding steps done
- `crm_choice` — `'smart_dash' | 'external' | 'skip'`
- Completion flags: `business_dna_done`, `knowledge_uploaded`, `connections_done`, `first_agent_done`, `first_campaign_done`, `analysis_done`, `telephony_done`

**Migration must be applied manually** in Supabase SQL Editor: `ONBOARDING_V2_MIGRATION.sql`

## Auth Context

`requireSupabaseAuth` middleware exposes: `context.userId`, `context.workspaceId`, `context.claims`, `context.supabase`. There is NO `context.user` object — always use `context.userId`.

## Path Routing Logic

- `agent_builder` → Welcome → Path → Summary (links to `/builder`) → existing OnboardingTour activates
- `grow` → Welcome → Path → DNA form → CRM choice → Summary (links to `/growthmind`)
- `both` → Welcome → Path → DNA form → CRM choice → Summary (links to `/growthmind`); OnboardingTour also available

## Knowledge Tier Rules

**Must be enforced in `executive-knowledge-seed.server.ts`:**
- `SEED_TOPICS` = Tier 1 (platform frameworks only — AIDA, PAS, playbooks, etc.)
- NO WEBEE products, pricing, campaigns, or business content in SEED_TOPICS
- Customer-specific content lives in Tier 2 (workspace uploads) + Tier 3 (Business DNA)

**Why:** Platform seed runs for every new customer workspace. WEBEE business content would bleed across all workspaces.

## Server Functions

All in `src/lib/onboarding/onboarding.server.ts`:
- `getOnboardingState()` — no-input, call as `getStateFn()`
- `setOnboardingPath({ data: { path } })` — wrapping required
- `completeOnboardingStep({ data: { ...flags } })` — partial update via upsert
- `dismissOnboarding()` — no-input
- `saveOnboardingBusinessDna({ data: { ...fields } })` — writes to `growthmind_business_dna` + sets `business_dna_done`

## Layout Mounting (`_authenticated.tsx`)

Order: `<OnboardingWelcome />` → `<GatedOnboardingTour />` → `<OnboardingChecklist />` → `<HiveMindOrb />`

`GatedOnboardingTour` wraps the legacy tour and suppresses it when `path === 'grow'`. Pre-V2 users (no DB row) still see the tour.
