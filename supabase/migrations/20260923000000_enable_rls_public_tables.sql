-- Enable row-level security on the seven public tables that had it switched off.
--
-- Supabase's security advisor flagged these as `rls_disabled_in_public`. With RLS off, PostgREST
-- applies only the table grants, and `anon` holds SELECT, INSERT, UPDATE, DELETE and TRUNCATE on
-- every one of them — while the anon key ships inside the frontend bundle. All seven are currently
-- empty, so nothing has been disclosed, but they were writable by anyone who had the URL:
--   * growthmind_ad_* could be filled with fabricated ad spend, campaigns and budget alerts;
--   * api_rate_limit_log backs the developer API rate limiter, so its rows could be deleted to
--     reset a caller's own limit.
--
-- Policies are scoped with is_workspace_member(), the existing helper (STABLE SECURITY DEFINER with
-- a pinned search_path) already used by 24 policies here. The service role bypasses RLS, so every
-- server-side writer — the ad sync ticks, the Meta/TikTok webhooks, the log retention sweep and the
-- rate limiter — keeps working untouched.
--
-- Note on the two log tables: they get RLS with no user policy at all, because only the service
-- role reads or writes them and an internal counter keyed by API token is not a user's to see.
-- That is deliberate, not an omission.

-- ── Ads tables the GrowthMind UI reads through a user-scoped client ──────────
-- These are reached from createServerFn handlers using context.supabase, so they need real
-- policies; RLS alone would make the ads performance page silently return nothing.
do $$
declare
  t text;
begin
  foreach t in array array[
    'growthmind_ad_campaigns',
    'growthmind_ad_budget_caps',
    'growthmind_ad_budget_alerts',
    'growthmind_ad_sync_log',
    'growthmind_ad_performance_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_workspace_members', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (is_workspace_member(workspace_id, auth.uid())) '
      || 'with check (is_workspace_member(workspace_id, auth.uid()))',
      t || '_workspace_members', t
    );
  end loop;
end $$;

-- ── Internal logs: service role only, no user-facing policy ─────────────────
alter table public.api_rate_limit_log enable row level security;
alter table public.growthmind_ad_webhook_events enable row level security;
