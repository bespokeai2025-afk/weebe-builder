---
name: HiveMind architecture
description: HiveMind is an observer-only platform layer — 4 flat routes, shared shell, extracted recommendation engine.
---

## Route structure
Flat files, no parent layout route needed:
- `routes/_authenticated/hivemind.tsx` → `/hivemind` (Overview / Executive Summary)
- `routes/_authenticated/hivemind.recommendations.tsx` → `/hivemind/recommendations`
- `routes/_authenticated/hivemind.reports.tsx` → `/hivemind/reports`
- `routes/_authenticated/hivemind.system-health.tsx` → `/hivemind/system-health`

Each page wraps itself in `<HiveMindShell>` (`components/hivemind/HiveMindShell.tsx`), which renders a left mini-sidebar with the 4 nav items. Active state is determined from `useRouterState().location.pathname`.

## Data layer
Single server fn: `getHiveMindPlatformData` in `lib/hivemind/hivemind.functions.ts`.
Fetches in parallel: agents, calls (30d), leads, calendar_bookings, workspace_settings, call_campaigns, whatsapp_messages, wati_contacts, telephony_calls, hexmail_campaigns, phone_numbers, calls (today).

Returns: `{ agents, agentScores, today, calls, leads, bookings, campaigns, whatsapp, telephony, email, phoneNumbers, costs, systemHealth, settings, tasks }`.

**Why:** Single query aggregator keeps all HiveMind pages fast (React Query caches with staleTime=60s shared by queryKey "hivemind-data").

## Recommendation engine
Extracted to `lib/hivemind/recommendations.ts` — pure function `generateRecommendations(data)`.
Categories: Setup, Agent Health, Pipeline, Campaigns, Conversion, WhatsApp, Telephony.
Priorities: critical → high → medium → low (sorted).

**Why:** Keeping it pure (no hooks) means it can be called from any page without re-fetching.

## Observer constraint
HiveMind must never take autonomous actions — it only reads, scores, and recommends.
The `saveHiveMindTasks` function is an exception (user-initiated task persistence only).

## Column safety
`workspace_settings` columns `hivemind_retell_agent_id` and `hivemind_tasks` may not exist — always catch error code 42703 and return `{ columnMissing: true }` gracefully.
