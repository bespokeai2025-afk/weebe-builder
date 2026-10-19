-- Indexes for the slow paths found in pg_stat_statements (Phase 3).
--
-- • leads.scheduled_agent_id → agents (ON DELETE SET NULL) had no index, so every agent delete
--   scanned the whole 1.8 GB leads table (3.5–4.5 s per delete).
-- • Many lead lists filter by workspace and sort by created_at; only (workspace_id, updated_at)
--   existed.
-- • whatsapp_messages.lead_id → leads had no index (each lead delete scanned it).
-- • leads_workspace_id_idx1 is an exact duplicate of leads_workspace_id_idx.
--
-- Built CONCURRENTLY so writes keep flowing; run each statement on its own (not in a transaction).

create index concurrently if not exists leads_scheduled_agent_id_idx
  on public.leads (scheduled_agent_id)
  where scheduled_agent_id is not null;

create index concurrently if not exists leads_workspace_created_idx
  on public.leads (workspace_id, created_at desc);

create index concurrently if not exists whatsapp_messages_lead_id_idx
  on public.whatsapp_messages (lead_id)
  where lead_id is not null;

drop index concurrently if exists public.leads_workspace_id_idx1;
