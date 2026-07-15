-- Master Admin oversight (Task: package matrix persistence)
-- Additive only. Apply via Management API or SQL Editor.

alter table public.package_definitions
  add column if not exists max_child_accounts integer,
  add column if not exists notification_caps_json jsonb not null default '{}'::jsonb,
  add column if not exists notification_defaults_json jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid;

-- Platform-level audit entries (package matrix edits, migration runs) have no
-- single workspace — allow NULL workspace_id.
alter table public.workspace_access_audit_logs
  alter column workspace_id drop not null;

-- Re-pin the member read policy so NULL-workspace (platform-level) rows are
-- explicitly excluded from member reads regardless of policy drift. Platform
-- admins read them via the service role only.
drop policy if exists "waal members read" on public.workspace_access_audit_logs;
create policy "waal members read" on public.workspace_access_audit_logs
  for select to authenticated
  using (
    workspace_id is not null
    and workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );
