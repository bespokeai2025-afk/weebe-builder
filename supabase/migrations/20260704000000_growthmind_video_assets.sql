-- GrowthMind Video Studio: asset storage table
-- Apply in Supabase SQL Editor

create table if not exists growthmind_video_assets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  title          text not null,
  video_type     text not null,
  provider       text,
  script         text not null default '',
  storyboard     jsonb not null default '[]',
  video_url      text,
  audio_url      text,
  voice_id       text,
  quality_mode   text not null default 'fast',
  cost_estimate  numeric(10,6) not null default 0,
  scheduled_at   date,
  created_at     timestamptz not null default now()
);

create index if not exists growthmind_video_assets_workspace_idx
  on growthmind_video_assets(workspace_id, created_at desc);

create index if not exists growthmind_video_assets_type_idx
  on growthmind_video_assets(workspace_id, video_type);

-- Row-level security
alter table growthmind_video_assets enable row level security;

create policy "workspace members can manage video assets"
  on growthmind_video_assets
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );
