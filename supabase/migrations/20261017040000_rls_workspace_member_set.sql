-- Faster workspace RLS: check membership once per query instead of once per row.
--
-- 38 policies used `is_workspace_member(workspace_id, auth.uid())`. That function is SECURITY
-- DEFINER with a pinned search_path, so Postgres can't inline it and calls it for every row: a
-- user-scoped count of the WBAH workspace's 496k leads took 6.8 s (workspace_members had been
-- scanned 140 million times). `workspace_id IN (SELECT current_user_workspace_ids())` is the
-- same rule — a row is visible when its workspace has a membership row for auth.uid() — but the
-- set is computed once and hashed: the same count takes 160 ms.
--
-- Only that exact expression is rewritten; every other part of each policy is kept as it was.

create or replace function public.current_user_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid()
$$;

revoke all on function public.current_user_workspace_ids() from public, anon;
grant execute on function public.current_user_workspace_ids() to authenticated, service_role;

do $$
declare
  p record;
  old_expr constant text := 'is_workspace_member(workspace_id, auth.uid())';
  new_expr constant text := '(workspace_id IN ( SELECT current_user_workspace_ids() AS current_user_workspace_ids))';
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%' || old_expr || '%' or coalesce(with_check, '') like '%' || old_expr || '%')
  loop
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      stmt := stmt || format(' using (%s)', replace(p.qual, old_expr, new_expr));
    end if;
    if p.with_check is not null then
      stmt := stmt || format(' with check (%s)', replace(p.with_check, old_expr, new_expr));
    end if;
    execute stmt;
  end loop;
end $$;
