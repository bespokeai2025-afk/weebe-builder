---
name: HiveMind Phase 3 tasks & events
description: Architecture for the task management + event monitoring system added in Phase 3.
---

## Tables
- `hivemind_tasks` — status: suggested/approved/in_progress/completed; priority: low/medium/high/critical; trigger_type+entity_id for dedup; comments JSONB array.
- `hivemind_events` — event_type, severity (info/warning/critical), is_read; dedup checked within 24h window before insert.

## Scanner deduplication
`runHiveMindScan` loads existing open tasks (status != 'completed') and events from last 24h, then skips any finding whose trigger_type+entity_id already exists. This prevents duplicate tasks on repeated scans.

**Why:** Running the scanner on every page load requires idempotency or tasks explode.

## Scanner checks (6 checks)
1. Idle leads — active status + updated_at < 14 days → aggregate task
2. Agent not deployed — per agent, retell_agent_id null
3. Campaign stalled — active + 2 days old + 0 completions
4. Document no KB — recent docs + no agents with knowledgeBase in settings
5. WhatsApp not configured — workspace_settings.whatsapp_phone_id null
6. OpenAI missing — neither env var nor workspace_settings key

## Shell badge
`HiveMindShell` uses useQuery (staleTime 60s, refetchInterval 120s) to show badge on Tasks nav item. Badge = unread events + suggested tasks count.

## AI context injection
`buildPlatformContext` accepts `tasks` field; `getHiveMindAIResponse` fetches task counts alongside platform data (3-way Promise.all).

## Migration
File: `supabase/migrations/20260622000000_hivemind_phase3.sql` — must be applied manually in Supabase SQL Editor.
