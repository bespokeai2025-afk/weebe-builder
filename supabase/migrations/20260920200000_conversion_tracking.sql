-- Google Ads conversion-tracking repair (additive, idempotent).
-- 1. conversion_events: server-write-only ledger of confirmed conversion
--    events (lead created / demo booked / Ava-qualified lead) with click-ID
--    attribution and Google upload acknowledgement status.
-- 2. leads: click-ID attribution columns (gclid / gbraid / wbraid).
-- 3. ava_call_requests: attribution jsonb captured at request time.

create table if not exists public.conversion_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  conversion_name  text not null,
  source           text not null,           -- webform | contact_form | ava_call
  lead_id          uuid,
  record_ref       jsonb not null default '{}'::jsonb,
  gclid            text,
  gbraid           text,
  wbraid           text,
  landing_url      text,
  dedup_key        text not null,
  -- recorded | duplicate_suppressed | no_attribution | pending_config
  -- | uploaded | upload_failed
  delivery_status  text not null default 'recorded',
  provider_response jsonb,
  last_error       text,
  uploaded_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists uq_conversion_events_dedup
  on public.conversion_events (dedup_key);
create index if not exists idx_conversion_events_ws_created
  on public.conversion_events (workspace_id, created_at desc);
create index if not exists idx_conversion_events_ws_name_created
  on public.conversion_events (workspace_id, conversion_name, created_at desc);

alter table public.conversion_events enable row level security;

drop policy if exists "conversion_events_members_select" on public.conversion_events;
create policy "conversion_events_members_select"
  on public.conversion_events
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = conversion_events.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- Server-write-only: strip default grants, re-grant SELECT only.
revoke all on public.conversion_events from authenticated;
revoke all on public.conversion_events from anon;
grant select on public.conversion_events to authenticated;

-- Click-ID attribution on leads (nullable, only set when genuinely present).
alter table public.leads add column if not exists gclid  text;
alter table public.leads add column if not exists gbraid text;
alter table public.leads add column if not exists wbraid text;

-- Attribution snapshot captured when an Ava call is requested.
alter table public.ava_call_requests add column if not exists attribution jsonb;
