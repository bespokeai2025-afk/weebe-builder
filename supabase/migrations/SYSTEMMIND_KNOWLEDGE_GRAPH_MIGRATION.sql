-- ── SystemMind Knowledge Graph (spec Phases 5, 6, 8) ─────────────────────────
-- Apply MANUALLY in the Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Strictly ADDITIVE. Idempotent: every statement uses IF NOT EXISTS / guards.
--
-- Adds a descriptive, per-workspace knowledge graph that connects everything
-- WEBEE knows (builder/agent templates, n8n workflows, SystemMind templates,
-- Retell agents, API Engine, HiveMind/GrowthMind/SystemMind, analytics,
-- integrations/providers, CRM adapters + universal actions, infrastructure,
-- deployment history) into nodes + edges. The graph is DERIVED data: the
-- builder does a full idempotent rebuild per workspace. Nothing here mutates
-- any source system. No credentials are ever stored — node metadata carries
-- presence booleans / counts only.

-- ── (A) Graph nodes ───────────────────────────────────────────────────────────
create table if not exists public.systemmind_graph_nodes (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces(id) on delete cascade,

  node_type     text        not null,   -- workspace | agent | agent_template | n8n_workflow |
                                        -- workflow_template | api_connection | api_endpoint |
                                        -- hivemind | growthmind | systemmind | analytics |
                                        -- integration | crm_adapter | universal_action |
                                        -- deployment | infrastructure
  source_table  text,                   -- origin table (null for static/derived nodes)
  source_id     text,                   -- origin row id AS TEXT (Retell/builder ids aren't uuids)
  node_key      text        not null,   -- stable dedupe key: "<source_table>:<id>" or "static:crm:hubspot"

  label         text        not null,
  summary       text,
  status        text,                   -- healthy | connected | disconnected | draft | ...
  tags          text[]      not null default '{}',
  metadata      jsonb       not null default '{}'::jsonb,  -- REDACTED: presence booleans / counts only

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, node_key)
);
create index if not exists sm_graph_nodes_ws_idx   on public.systemmind_graph_nodes (workspace_id);
create index if not exists sm_graph_nodes_type_idx on public.systemmind_graph_nodes (workspace_id, node_type);

-- ── (B) Graph edges ───────────────────────────────────────────────────────────
create table if not exists public.systemmind_graph_edges (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces(id) on delete cascade,
  from_node_id  uuid        not null references public.systemmind_graph_nodes(id) on delete cascade,
  to_node_id    uuid        not null references public.systemmind_graph_nodes(id) on delete cascade,
  edge_type     text        not null,   -- belongs_to | uses_provider | maps_to_action |
                                        -- derived_from | deployed_as | depends_on |
                                        -- integrates_with | supported_by
  metadata      jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (workspace_id, from_node_id, to_node_id, edge_type)
);
create index if not exists sm_graph_edges_ws_idx   on public.systemmind_graph_edges (workspace_id);
create index if not exists sm_graph_edges_from_idx on public.systemmind_graph_edges (from_node_id);
create index if not exists sm_graph_edges_to_idx   on public.systemmind_graph_edges (to_node_id);

-- ── (C) Build history ─────────────────────────────────────────────────────────
create table if not exists public.systemmind_graph_builds (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references public.workspaces(id) on delete cascade,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  node_count     integer     not null default 0,
  edge_count     integer     not null default 0,
  source_results jsonb       not null default '[]'::jsonb,  -- [{ source, count, error }]
  errors         jsonb       not null default '[]'::jsonb,
  built_by       uuid,
  created_at     timestamptz not null default now()
);
create index if not exists sm_graph_builds_ws_idx on public.systemmind_graph_builds (workspace_id, started_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.systemmind_graph_nodes  enable row level security;
alter table public.systemmind_graph_edges  enable row level security;
alter table public.systemmind_graph_builds enable row level security;

-- Policies are intentionally SELECT-only for authenticated members. All writes
-- (the full rebuild) flow through the service-role client inside the admin-gated
-- server functions, so members can never forge graph state via direct PostgREST.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_graph_nodes' and policyname = 'sm_graph_nodes_sel') then
    create policy "sm_graph_nodes_sel" on public.systemmind_graph_nodes for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_graph_edges' and policyname = 'sm_graph_edges_sel') then
    create policy "sm_graph_edges_sel" on public.systemmind_graph_edges for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'systemmind_graph_builds' and policyname = 'sm_graph_builds_sel') then
    create policy "sm_graph_builds_sel" on public.systemmind_graph_builds for select
      using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────
grant select on public.systemmind_graph_nodes  to authenticated;
grant select on public.systemmind_graph_edges  to authenticated;
grant select on public.systemmind_graph_builds to authenticated;
grant all on public.systemmind_graph_nodes  to service_role;
grant all on public.systemmind_graph_edges  to service_role;
grant all on public.systemmind_graph_builds to service_role;
