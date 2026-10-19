-- Platform-admin suspend / activate for a client workspace (SystemMind → Clients).
-- The admin page reads and writes workspace_settings.workspace_status, but the column was never
-- created, so the Clients list errored and the Suspend button always failed.
alter table public.workspace_settings
  add column if not exists workspace_status text not null default 'active';

do $$
begin
  alter table public.workspace_settings
    add constraint workspace_settings_workspace_status_check
    check (workspace_status in ('active', 'suspended'));
exception when duplicate_object then null;
end $$;
