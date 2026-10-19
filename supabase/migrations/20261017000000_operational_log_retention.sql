-- Daily retention for the three operational logs that were growing without bound:
--   • automation_execution_steps  (61 GB) — pruned through its parent execution (ON DELETE CASCADE)
--   • wbah_post_call_jobs         (946 MB) — completed jobs only; pending/processing rows are live work
--   • retell_webhook_events       (3.6 GB) — the debug_snapshot rows (no longer written)
--
-- Runs inside the database on pg_cron, so it doesn't depend on the app's campaign-executor tick
-- (whose cron URL was a placeholder, so the app-side sweep never ran in production).
-- Deletes go in batches so no single statement holds locks for long; a large backlog
-- drains over a few nightly runs.

create index if not exists idx_automation_executions_started
  on public.automation_workflow_executions (started_at);

create index if not exists idx_wbah_post_call_jobs_completed_created
  on public.wbah_post_call_jobs (created_at)
  where status = 'completed';

create or replace function public.prune_operational_logs(
  keep_days integer default 30,
  batch_size integer default 2000,
  max_batches integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => keep_days);
  n integer;
  i integer;
  executions_deleted bigint := 0;
  jobs_deleted bigint := 0;
  snapshots_deleted bigint := 0;
begin
  -- Executions (their steps and queue rows cascade). Never touch runs that are still going.
  for i in 1..max_batches loop
    delete from automation_workflow_executions
    where id in (
      select id from automation_workflow_executions
      where started_at < cutoff
        and status in ('completed', 'failed', 'cancelled')
      limit batch_size
    );
    get diagnostics n = row_count;
    executions_deleted := executions_deleted + n;
    exit when n < batch_size;
  end loop;

  for i in 1..max_batches loop
    delete from wbah_post_call_jobs
    where id in (
      select id from wbah_post_call_jobs
      where status = 'completed' and created_at < cutoff
      limit batch_size
    );
    get diagnostics n = row_count;
    jobs_deleted := jobs_deleted + n;
    exit when n < batch_size;
  end loop;

  for i in 1..max_batches loop
    delete from retell_webhook_events
    where id in (
      select id from retell_webhook_events
      where event_type = 'debug_snapshot'
      limit batch_size
    );
    get diagnostics n = row_count;
    snapshots_deleted := snapshots_deleted + n;
    exit when n < batch_size;
  end loop;

  return jsonb_build_object(
    'cutoff', cutoff,
    'executions_deleted', executions_deleted,
    'wbah_jobs_deleted', jobs_deleted,
    'debug_snapshots_deleted', snapshots_deleted
  );
end;
$$;

revoke all on function public.prune_operational_logs(integer, integer, integer) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'prune-operational-logs';
select cron.schedule('prune-operational-logs', '30 3 * * *', $$select public.prune_operational_logs(30)$$);
