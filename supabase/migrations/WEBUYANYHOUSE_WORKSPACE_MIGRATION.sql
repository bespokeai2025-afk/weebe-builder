-- =====================================================================
-- WEBUYANYHOUSE WORKSPACE MIGRATION
-- Apply in Supabase SQL Editor: https://app.supabase.com
-- =====================================================================

-- Workspace-scoped imported leads table
create table if not exists webuyanyhouse_imported_leads (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  source               text not null default 'webespoke_enterprise_api',
  source_section       text not null,   -- disqualified | tried_to_contact | new_lead | unknown
  external_id          text,
  lead_name            text,
  phone                text,
  email                text,
  property_address     text,
  postcode             text,
  expected_price       text,
  current_status       text,
  assigned_agent       text,
  last_call_attempt    timestamptz,
  call_attempt_count   integer,
  call_outcome         text,
  qualification_status text,
  qualification_summary text,
  sentiment            text,
  n8n_workflow_id      text,
  notes                text,
  raw_payload          jsonb not null default '{}',
  synced_at            timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Deduplicate on workspace + source + external_id
create unique index if not exists webuyanyhouse_leads_dedup
  on webuyanyhouse_imported_leads (workspace_id, source, external_id)
  where external_id is not null;

-- Fast lookups
create index if not exists webuyanyhouse_leads_workspace
  on webuyanyhouse_imported_leads (workspace_id);

create index if not exists webuyanyhouse_leads_section
  on webuyanyhouse_imported_leads (workspace_id, source_section);

-- Row-level security: workspace members only
alter table webuyanyhouse_imported_leads enable row level security;

create policy "workspace members can read their leads"
  on webuyanyhouse_imported_leads for select
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = webuyanyhouse_imported_leads.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- Admin client bypasses RLS (service role key used server-side)
