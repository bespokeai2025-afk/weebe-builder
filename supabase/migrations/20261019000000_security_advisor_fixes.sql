-- Supabase security advisor fixes.
--
-- 1. workspace_webhooks / webhook_deliveries: the *_isolation policies trusted
--    auth.jwt() -> user_metadata -> workspace_id. user_metadata is editable by the user
--    (supabase.auth.updateUser({ data })), so any signed-in user could read or rewrite another
--    workspace's webhooks — including the signing secret and the target URL. The app only uses
--    these tables server-side with the service role (which bypasses RLS), so browser access is
--    removed entirely: RLS on, no policies, no grants.
-- 2. seat_utilisation: SECURITY DEFINER view (ran as postgres, skipping RLS) granted to anon.
--    security_invoker makes it follow the caller's RLS on workspace_seat_billing /
--    workspace_members, which already limit rows to the user's own workspaces.

drop policy if exists workspace_webhooks_isolation on public.workspace_webhooks;
drop policy if exists webhook_deliveries_isolation on public.webhook_deliveries;
alter table public.workspace_webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
revoke all on public.workspace_webhooks, public.webhook_deliveries from anon, authenticated;

alter view public.seat_utilisation set (security_invoker = true);
revoke all on public.seat_utilisation from anon;
