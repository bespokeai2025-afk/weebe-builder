-- ── "Call Ava Now" homepage flow — request/audit table ────────────────────────
-- Visitors who request an Ava call (OTP-verified) are recorded here.
-- A WEBEE lead is created ONLY after the Retell post-call webhook confirms
-- appointment_booked AND sentiment positive/neutral. NEVER creates need_to_call leads.
-- Additive + idempotent. Service-role access only (RLS enabled, no policies).

create table if not exists public.ava_call_requests (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  full_name        text,
  email            text not null,
  phone            text not null,
  website          text,
  -- pending_verification → ava_call_requested → call_triggered →
  -- completed_lead_created | completed_no_lead | needs_review | failed | expired
  status           text not null default 'pending_verification',
  otp_hash         text,
  otp_expires_at   timestamptz,
  otp_attempts     integer not null default 0,
  retell_call_id   text,
  from_number      text,
  call_outcome     jsonb,
  lead_id          uuid,
  processed_at     timestamptz,
  ip_address       text,
  user_agent       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_ava_call_requests_retell_call_id
  on public.ava_call_requests (retell_call_id);

create index if not exists idx_ava_call_requests_ws_created
  on public.ava_call_requests (workspace_id, created_at desc);

create index if not exists idx_ava_call_requests_phone_created
  on public.ava_call_requests (phone, created_at desc);

-- Service-role only: enable RLS with no policies (deny-all for anon/authenticated).
alter table public.ava_call_requests enable row level security;
