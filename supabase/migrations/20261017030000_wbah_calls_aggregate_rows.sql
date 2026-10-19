-- One-query read of every WBAH call for the Leads / Qualified / Calendar / Pipeline aggregate.
--
-- The app used to fetch wbah_calls as ~140 parallel 1,000-row OFFSET pages. Each deep page re-read
-- every row before it, so one rebuild cost ~290 s of database time (2.1 s mean per page — the top
-- query in pg_stat_statements). This is a single index-ordered scan (~1 s) returned as one JSON
-- array, which also sidesteps PostgREST's 1,000-row cap.

create or replace function public.wbah_calls_aggregate_rows(p_workspace_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(t), '[]'::json)
  from (
    select id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds,
           started_at, recording_url, disconnection_reason, end_reason, appointment_date,
           appointment_time, booking_status, calendly_booking_url
    from wbah_calls
    where workspace_id = p_workspace_id
    order by started_at desc nulls last, id asc
  ) t
$$;

revoke all on function public.wbah_calls_aggregate_rows(uuid) from public, anon, authenticated;
grant execute on function public.wbah_calls_aggregate_rows(uuid) to service_role;
