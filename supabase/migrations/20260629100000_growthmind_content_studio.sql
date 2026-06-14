-- GrowthMind Content Studio
-- Tables: content_folders, content_assets, content_templates,
--         content_generations, content_campaign_links

-- ── Content Folders ──────────────────────────────────────────────────────────

create table if not exists growthmind_content_folders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  icon         text not null default 'folder',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table growthmind_content_folders enable row level security;

create policy "workspace members can manage content folders"
  on growthmind_content_folders
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- ── Content Assets ────────────────────────────────────────────────────────────

create table if not exists growthmind_content_assets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  folder_id      uuid references growthmind_content_folders(id) on delete set null,
  title          text not null check (length(trim(title)) > 0),
  content_type   text not null,
  content        text not null default '',
  brief          jsonb not null default '{}',
  seo_data       jsonb not null default '{}',
  status         text not null default 'draft'
                   check (status in ('draft', 'published', 'archived')),
  is_favourite   boolean not null default false,
  scheduled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table growthmind_content_assets enable row level security;

create policy "workspace members can manage content assets"
  on growthmind_content_assets
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

create index if not exists idx_growthmind_content_assets_workspace
  on growthmind_content_assets(workspace_id, created_at desc);

create index if not exists idx_growthmind_content_assets_folder
  on growthmind_content_assets(folder_id)
  where folder_id is not null;

-- ── Content Templates ─────────────────────────────────────────────────────────

create table if not exists growthmind_content_templates (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  content_type   text not null,
  brief_defaults jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

alter table growthmind_content_templates enable row level security;

create policy "workspace members can manage content templates"
  on growthmind_content_templates
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- ── Content Generation History ────────────────────────────────────────────────

create table if not exists growthmind_content_generations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id     uuid references growthmind_content_assets(id) on delete set null,
  content_type text not null,
  brief        jsonb not null default '{}',
  tokens_used  int,
  created_at   timestamptz not null default now()
);

alter table growthmind_content_generations enable row level security;

create policy "workspace members can view content generations"
  on growthmind_content_generations
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- ── Campaign Links ────────────────────────────────────────────────────────────

create table if not exists growthmind_content_campaign_links (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  asset_id      uuid not null references growthmind_content_assets(id) on delete cascade,
  campaign_type text not null,
  campaign_id   text not null,
  created_at    timestamptz not null default now()
);

alter table growthmind_content_campaign_links enable row level security;

create policy "workspace members can manage campaign links"
  on growthmind_content_campaign_links
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );
