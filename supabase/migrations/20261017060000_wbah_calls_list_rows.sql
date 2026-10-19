-- One-query read of the WBAH Calls page list (lite columns), replacing a ~140-page OFFSET walk
-- (each deep page re-read every earlier row). Transcripts are not sent — only whether one exists.
--
-- Called with the user's own client, so it enforces the same rule as the wbah_calls RLS policy:
-- the caller must be a member of the workspace (or the service role).

create or replace function public.wbah_calls_list_rows(p_workspace_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(t), '[]'::json)
  from (
    select id, customer_name, phone, agent_name, call_status, call_type, sentiment,
           duration_seconds, started_at, recording_url, disconnection_reason, end_reason,
           appointment_date, appointment_time, booking_status, calendly_booking_url, call_count,
           call_summary,
           (transcript is not null and btrim(transcript) <> '') as has_transcript
    from wbah_calls
    where workspace_id = p_workspace_id
      and (
        auth.role() = 'service_role'
        or p_workspace_id in (select public.current_user_workspace_ids())
      )
    order by started_at desc nulls last, id asc
  ) t
$$;

revoke all on function public.wbah_calls_list_rows(uuid) from public, anon;
grant execute on function public.wbah_calls_list_rows(uuid) to authenticated, service_role;
