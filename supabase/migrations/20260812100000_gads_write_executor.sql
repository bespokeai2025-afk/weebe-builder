-- Google Ads write executor: Negative Keyword Decision Log + honest
-- change-request lifecycle linkage to marketing_actions.
-- Idempotent / additive only.

-- ── Negative Keyword Decision Log (PERMANENT — keep forever by design) ───────
-- Append-only audit of every search term ever CONSIDERED for exclusion:
-- the four-way classification, the decision taken, who approved, and the
-- evidence. Intentionally has NO retention rule: this log is the durable
-- record explaining why terms were or were not excluded.
create table if not exists public.growthmind_gads_negative_decision_log (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  account_row_id      uuid,
  customer_id         text,
  campaign_id         text,
  campaign_name       text,
  search_term         text not null,
  match_type          text,
  classification      text not null check (classification in ('relevant','irrelevant','uncertain','high_value_discovery')),
  decision            text not null check (decision in ('recommended_negative','not_recommended','approved','declined','applied','apply_failed')),
  reason              text,
  evidence            jsonb not null default '{}'::jsonb,
  decided_by          uuid,          -- user who approved/declined (null = system classification)
  marketing_action_id uuid,          -- linked marketing_actions row when executable
  recommendation_id   uuid,
  created_at          timestamptz not null default now()
);
create index if not exists gads_neg_log_ws_created_idx
  on public.growthmind_gads_negative_decision_log (workspace_id, created_at desc);
create index if not exists gads_neg_log_ws_term_idx
  on public.growthmind_gads_negative_decision_log (workspace_id, search_term);

alter table public.growthmind_gads_negative_decision_log enable row level security;
drop policy if exists "gads_neg_log_members_read" on public.growthmind_gads_negative_decision_log;
create policy "gads_neg_log_members_read"
  on public.growthmind_gads_negative_decision_log for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = growthmind_gads_negative_decision_log.workspace_id
                   and m.user_id = auth.uid()));
revoke insert, update, delete on public.growthmind_gads_negative_decision_log from authenticated, anon;
grant all on public.growthmind_gads_negative_decision_log to service_role;

-- ── Change requests: link to marketing_actions + honest statuses ─────────────
alter table public.growthmind_gads_change_requests
  add column if not exists marketing_action_id uuid,
  add column if not exists status_detail text;

-- Widen the status check: submitted (handed to the engine), failed.
alter table public.growthmind_gads_change_requests
  drop constraint if exists growthmind_gads_change_requests_status_check;
alter table public.growthmind_gads_change_requests
  add constraint growthmind_gads_change_requests_status_check
  check (status in ('approved','cancelled','executed','submitted','failed','draft'));

create index if not exists gads_change_requests_marketing_action_idx
  on public.growthmind_gads_change_requests (marketing_action_id)
  where marketing_action_id is not null;
