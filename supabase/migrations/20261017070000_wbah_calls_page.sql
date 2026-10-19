-- Server-side pagination for the WBAH Calls page.
--
-- The page used to download every call (~138k rows, ~35 MB) and filter, count and page in the
-- browser. These two functions do that work in the database:
--   • wbah_calls_page    — one filtered, sorted page plus the filtered total
--   • wbah_calls_summary — the KPI strip (voicemail filter only, as before) and the agent lists
-- Filter semantics mirror the old client-side code in src/routes/_authenticated/calls.tsx.
-- Both run with the caller's client and enforce membership like the wbah_calls RLS policy.
-- Filters are written inline (not via a helper) so Postgres plans them as plain predicates.

drop function if exists public.wbah_calls_filter_match(public.wbah_calls, jsonb);

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
      nullif(x->>'agentName', '')                                    as agent,
      coalesce(nullif(x->>'minDuration', '')::integer, 0)            as min_dur,
      nullif(x->>'outcome', '')                                      as outcome,
      nullif(x->>'dateFrom', '')::timestamptz                        as date_from,
      nullif(x->>'dateTo', '')::timestamptz                          as date_to
    from (select coalesce(p_filters, '{}'::jsonb) as x) src
  ),
  -- Only id + sort key here, so the filter pass never reads transcripts or summaries.
  m as materialized (
    select c.id, c.started_at
    from wbah_calls c, f
    where c.workspace_id = p_workspace_id
      and (auth.role() = 'service_role' or p_workspace_id in (select public.current_user_workspace_ids()))
      and (f.voicemail = 'all'
           or (f.voicemail = 'only') = (coalesce(c.disconnection_reason, '') ~* 'voicemail' or coalesce(c.end_reason, '') ~* 'voicemail'))
      and (f.search is null
           or strpos(lower(coalesce(c.customer_name, c.phone, '')), f.search) > 0
           or strpos(lower(coalesce(c.phone, '')), f.search) > 0)
      and (f.status is null or c.call_status = f.status)
      and (f.call_type is null or coalesce(c.call_type, 'outbound') = f.call_type)
      and (f.sentiment is null or c.sentiment = f.sentiment)
      and (f.agent is null or coalesce(c.agent_name, '') = f.agent)
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

create or replace function public.wbah_calls_summary(p_workspace_id uuid, p_voicemail text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total', count(*),
    'completed', count(*) filter (where call_status = 'completed'),
    'failed', count(*) filter (where call_status in ('failed', 'no_answer', 'busy')),
    'total_sec', coalesce(sum(duration_seconds), 0),
    'agent_names', coalesce(json_agg(distinct agent_name) filter (where coalesce(agent_name, '') <> ''), '[]'::json),
    -- Agents with a booking — drives the badge colour palette, like the old client-side list.
    'booked_agent_names', coalesce(json_agg(distinct agent_name) filter (
      where coalesce(agent_name, '') <> ''
        and (appointment_date is not null or calendly_booking_url like '%reschedulings/%')
    ), '[]'::json)
  )
  from wbah_calls c
  where c.workspace_id = p_workspace_id
    and (auth.role() = 'service_role' or p_workspace_id in (select public.current_user_workspace_ids()))
    and (coalesce(p_voicemail, 'exclude') = 'all'
         or (coalesce(p_voicemail, 'exclude') = 'only')
            = (coalesce(c.disconnection_reason, '') ~* 'voicemail' or coalesce(c.end_reason, '') ~* 'voicemail'))
$$;

revoke all on function public.wbah_calls_page(uuid, jsonb, integer, integer) from public, anon;
revoke all on function public.wbah_calls_summary(uuid, text) from public, anon;
grant execute on function public.wbah_calls_page(uuid, jsonb, integer, integer) to authenticated, service_role;
grant execute on function public.wbah_calls_summary(uuid, text) to authenticated, service_role;
