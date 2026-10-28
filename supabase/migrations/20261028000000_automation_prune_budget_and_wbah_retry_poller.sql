-- Automation engine housekeeping that has never worked in production.
--
-- 1. prune-operational-logs has failed every night. The whole clean-up runs as one statement under
--    the 2-minute statement timeout, and one run tried to delete up to 100,000 executions with their
--    ~1.6M step rows (62 GB of step payloads) — it hit the timeout at exactly 2:00 every night, and
--    the timeout rolled back every batch it had finished, so nothing was ever removed. 180,576
--    executions are past the 30-day cut-off.
--
--    Each run now stops by itself after a time budget (60 s, half the timeout), so it always
--    returns and commits what it deleted. Small batches keep each delete short. It runs every
--    10 minutes until the backlog is gone, then each run finds little to do.
--
-- 2. Executions left "running" for ever: a step that threw escaped the runner, so the row was never
--    closed (1,219 rows). The code fix stops new ones; this closes old ones as failed after an hour
--    (the slowest completed run in the last 14 days took 98 s). They then age out like any other.
--
-- 3. The WBAH post-call retry poller (/api/public/wbah-post-call-queue) was never scheduled, so
--    every job that failed once stayed "pending". It now runs every minute. Its first run marks the
--    1,262 old pending jobs failed (older than the retry window) rather than replaying weeks-old
--    calls; they stay listed for a manual rerun.
--
-- Disk: deleted rows free space for reuse, so the tables stop growing, but the files don't shrink.
-- Reclaiming the 62 GB needs a one-off VACUUM FULL / pg_repack once the backlog is gone.

drop function if exists public.prune_operational_logs(integer, integer, integer);

create or replace function public.prune_operational_logs(
  keep_days integer default 30,
  batch_size integer default 100,
  time_budget_ms integer default 60000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => keep_days);
  deadline timestamptz := clock_timestamp() + make_interval(secs => time_budget_ms / 1000.0);
  n integer;
  abandoned_closed bigint := 0;
  executions_deleted bigint := 0;
  jobs_deleted bigint := 0;
  snapshots_deleted bigint := 0;
  executions_left boolean := true;
  jobs_left boolean := true;
  snapshots_left boolean := true;
begin
  -- Runs that stopped without finishing. Nothing resumes a "running" row; "waiting" rows are
  -- paused on purpose and are left alone.
  update automation_workflow_executions
     set status = 'failed',
         completed_at = coalesce(completed_at, now()),
         last_error = coalesce(last_error, 'Abandoned: the run stopped without finishing')
   where status = 'running'
     and started_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  abandoned_closed := n;

  -- Executions (their steps and queue rows cascade). Never touch runs that are still going.
  while executions_left and clock_timestamp() < deadline loop
    delete from automation_workflow_executions
    where id in (
      select id from automation_workflow_executions
      where started_at < cutoff
        and status in ('completed', 'failed', 'cancelled')
      limit batch_size
    );
    get diagnostics n = row_count;
    executions_deleted := executions_deleted + n;
    executions_left := n = batch_size;
  end loop;

  while jobs_left and clock_timestamp() < deadline loop
    delete from wbah_post_call_jobs
    where id in (
      select id from wbah_post_call_jobs
      where status = 'completed' and created_at < cutoff
      limit batch_size * 10
    );
    get diagnostics n = row_count;
    jobs_deleted := jobs_deleted + n;
    jobs_left := n = batch_size * 10;
  end loop;

  while snapshots_left and clock_timestamp() < deadline loop
    delete from retell_webhook_events
    where id in (
      select id from retell_webhook_events
      where event_type = 'debug_snapshot'
      limit batch_size * 10
    );
    get diagnostics n = row_count;
    snapshots_deleted := snapshots_deleted + n;
    snapshots_left := n = batch_size * 10;
  end loop;

  return jsonb_build_object(
    'cutoff', cutoff,
    'abandoned_closed', abandoned_closed,
    'executions_deleted', executions_deleted,
    'wbah_jobs_deleted', jobs_deleted,
    'debug_snapshots_deleted', snapshots_deleted,
    'backlog_remaining', executions_left or jobs_left or snapshots_left
  );
end;
$$;

revoke all on function public.prune_operational_logs(integer, integer, integer) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'prune-operational-logs';
select cron.schedule('prune-operational-logs', '*/10 * * * *', $$select public.prune_operational_logs(30)$$);

-- WBAH post-call retries (see 3 above). Same bearer key and helper as the other app jobs.
--
-- Close the old backlog here as well as in the poller, so a poller from before this release can
-- never replay it. Deploy the app first all the same: only the new poller holds back a Calendly
-- booking that an earlier attempt already made.
update public.wbah_post_call_jobs
   set status = 'failed',
       errors = jsonb_build_array('Not retried automatically: older than the retry window. Rerun it from the executions list.'),
       updated_at = now()
 where status in ('pending', 'processing')
   and created_at < now() - interval '6 hours';

insert into public.app_config (key, value) values
  ('wbah_post_call_queue_url', 'https://webeesmartdash.com/api/public/wbah-post-call-queue')
on conflict (key) do update set value = excluded.value;

select cron.unschedule(jobid) from cron.job where jobname = 'wbah-post-call-retries';
select cron.schedule('wbah-post-call-retries', '* * * * *', $$select public.cron_post('wbah_post_call_queue_url')$$);
