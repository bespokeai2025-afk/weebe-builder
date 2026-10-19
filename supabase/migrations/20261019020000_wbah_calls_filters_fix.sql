-- WBAH Calls page filter fixes.
--
-- • Agent filter: stored agent names often end in a space ("WBAH Tried to conatct agent "), while
--   the dropdown offers trimmed names — the exact comparison matched nothing. Compare trimmed.
-- • Status "voicemail": no call has that call_status (voicemail is recorded in
--   disconnection_reason / end_reason), so the option always returned nothing. It now selects
--   voicemail calls, whatever the voicemail toggle says.
-- • KPI cards follow the filters: wbah_calls_summary(uuid, jsonb) applies the same filters as the
--   table. Agent lists stay unfiltered (dropdown options and badge colours).
-- The old wbah_calls_summary(uuid, text) is kept for builds deployed before this change.

create or replace function public.wbah_calls_page(
  p_workspace_id uuid,
  p_filters jsonb,
  p_limit integer,
  p_offset integer
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select
      coalesce(nullif(x->>'voicemail', ''), 'exclude')             as voicemail,
      lower(nullif(btrim(coalesce(x->>'search', '')), ''))           as search,
      nullif(x->>'status', '')                                       as status,
      nullif(x->>'callType', '')                                     as call_type,
      nullif(x->>'sentiment', '')                                    as sentiment,
      nullif(btrim(coalesce(x->>'agentName', '')), '')               as agent,
      coalesce(nullif(x->>'minDuration', '')::integer, 0)            as min_dur,
      nullif(x->>'outcome', '')                                      as outcome,
      nullif(x->>'dateFrom', '')::timestamptz                        as date_from,
      nullif(x->>'dateTo', '')::timestamptz                          as date_to
    from (select coalesce(p_filters, '{}'::jsonb) as x) src
  ),
  m as materialized (
    select c.id, c.started_at
    from wbah_calls c, f,
         lateral (select (coalesce(c.disconnection_reason, '') ~* 'voicemail'
                          or coalesce(c.end_reason, '') ~* 'voicemail') as is_vm) v
    where c.workspace_id = p_workspace_id
      and (auth.role() = 'service_role' or p_workspace_id in (select public.current_user_workspace_ids()))
      and (f.voicemail = 'all' or f.status = 'voicemail' or (f.voicemail = 'only') = v.is_vm)
      and (f.search is null
           or strpos(lower(coalesce(c.customer_name, c.phone, '')), f.search) > 0
           or strpos(lower(coalesce(c.phone, '')), f.search) > 0)
      and (f.status is null
           or (f.status = 'voicemail' and v.is_vm)
           or (f.status <> 'voicemail' and c.call_status = f.status))
      and (f.call_type is null or coalesce(c.call_type, 'outbound') = f.call_type)
      and (f.sentiment is null or c.sentiment = f.sentiment)
      and (f.agent is null or btrim(coalesce(c.agent_name, '')) = f.agent)
      and (f.min_dur <= 0 or coalesce(c.duration_seconds, 0) >= f.min_dur)
      and (f.outcome is null
           or (f.outcome = 'successful' and c.call_status = 'completed')
           or (f.outcome = 'unsuccessful' and c.call_status in ('failed', 'no_answer', 'busy'))
           or f.outcome not in ('successful', 'unsuccessful'))
      and (f.date_from is null or (c.started_at is not null and c.started_at >= f.date_from))
      and (f.date_to is null or (c.started_at is not null and c.started_at <= f.date_to))
  ),
  page as (
    select id, started_at from m
    order by started_at desc nulls last, id asc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select json_build_object(
    'total', (select count(*) from m),
    'rows', coalesce((
      select json_agg(t order by t.started_at desc nulls last, t.id asc)
      from (
        select c.id, c.customer_name, c.phone, c.agent_name, c.call_status, c.call_type, c.sentiment,
               c.duration_seconds, c.started_at, c.recording_url, c.disconnection_reason, c.end_reason,
               c.appointment_date, c.appointment_time, c.booking_status, c.calendly_booking_url,
               c.call_count, c.call_summary,
               (c.transcript is not null and btrim(c.transcript) <> '') as has_transcript
        from page p
        join wbah_calls c on c.id = p.id
      ) t
    ), '[]'::json)
  )
$$;

create or replace function public.wbah_calls_summary(p_workspace_id uuid, p_filters jsonb)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select
      coalesce(nullif(x->>'voicemail', ''), 'exclude')             as voicemail,
      lower(nullif(btrim(coalesce(x->>'search', '')), ''))           as search,
      nullif(x->>'status', '')                                       as status,
      nullif(x->>'callType', '')                                     as call_type,
      nullif(x->>'sentiment', '')                                    as sentiment,
      nullif(btrim(coalesce(x->>'agentName', '')), '')               as agent,
      coalesce(nullif(x->>'minDuration', '')::integer, 0)            as min_dur,
      nullif(x->>'outcome', '')                                      as outcome,
      nullif(x->>'dateFrom', '')::timestamptz                        as date_from,
      nullif(x->>'dateTo', '')::timestamptz                          as date_to
    from (select coalesce(p_filters, '{}'::jsonb) as x) src
  ),
  allowed as (
    select (auth.role() = 'service_role' or p_workspace_id in (select public.current_user_workspace_ids())) ok
  ),
  scoped as (
    select c.call_status, c.duration_seconds, c.agent_name, c.appointment_date, c.calendly_booking_url,
           c.disconnection_reason, c.end_reason, c.customer_name, c.phone, c.call_type, c.sentiment,
           c.started_at
    from wbah_calls c, allowed
    where allowed.ok and c.workspace_id = p_workspace_id
  ),
  m as (
    select s.*
    from scoped s, f,
         lateral (select (coalesce(s.disconnection_reason, '') ~* 'voicemail'
                          or coalesce(s.end_reason, '') ~* 'voicemail') as is_vm) v
    where (f.voicemail = 'all' or f.status = 'voicemail' or (f.voicemail = 'only') = v.is_vm)
      and (f.search is null
           or strpos(lower(coalesce(s.customer_name, s.phone, '')), f.search) > 0
           or strpos(lower(coalesce(s.phone, '')), f.search) > 0)
      and (f.status is null
           or (f.status = 'voicemail' and v.is_vm)
           or (f.status <> 'voicemail' and s.call_status = f.status))
      and (f.call_type is null or coalesce(s.call_type, 'outbound') = f.call_type)
      and (f.sentiment is null or s.sentiment = f.sentiment)
      and (f.agent is null or btrim(coalesce(s.agent_name, '')) = f.agent)
      and (f.min_dur <= 0 or coalesce(s.duration_seconds, 0) >= f.min_dur)
      and (f.outcome is null
           or (f.outcome = 'successful' and s.call_status = 'completed')
           or (f.outcome = 'unsuccessful' and s.call_status in ('failed', 'no_answer', 'busy'))
           or f.outcome not in ('successful', 'unsuccessful'))
      and (f.date_from is null or (s.started_at is not null and s.started_at >= f.date_from))
      and (f.date_to is null or (s.started_at is not null and s.started_at <= f.date_to))
  )
  select json_build_object(
    'total', (select count(*) from m),
    'completed', (select count(*) from m where call_status = 'completed'),
    'failed', (select count(*) from m where call_status in ('failed', 'no_answer', 'busy')),
    'total_sec', (select coalesce(sum(duration_seconds), 0) from m),
    -- Unfiltered: dropdown options and badge colours must not change with the filters.
    'agent_names', coalesce((
      select json_agg(distinct btrim(agent_name)) from scoped where btrim(coalesce(agent_name, '')) <> ''
    ), '[]'::json),
    'booked_agent_names', coalesce((
      select json_agg(distinct btrim(agent_name)) from scoped
      where btrim(coalesce(agent_name, '')) <> ''
        and (appointment_date is not null or calendly_booking_url like '%reschedulings/%')
    ), '[]'::json)
  )
$$;

revoke all on function public.wbah_calls_summary(uuid, jsonb) from public, anon;
grant execute on function public.wbah_calls_summary(uuid, jsonb) to authenticated, service_role;
