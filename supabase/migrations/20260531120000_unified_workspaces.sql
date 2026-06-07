
SET search_path TO public, extensions;

-- =============================================================================
-- Phase 0: Unified workspace schema — merge webesmartdash into webebuilder
-- Applies safely on top of existing builder schema; backward compatible.
-- =============================================================================

-- ============================================================
-- 1. ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.user_type AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_source AS ENUM ('website','inbound','outbound','referral','import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_status AS ENUM ('need_to_call','calling','completed','interested','not_interested','not_connected','do_not_call','qualified');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.sentiment_kind AS ENUM ('positive','neutral','negative');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.call_type AS ENUM ('inbound','outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.call_status AS ENUM ('initiated','ringing','in_progress','completed','no_answer','busy','failed','voicemail');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_status AS ENUM ('pending','accepted','completed','cancelled','rescheduled','no_show');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.message_direction AS ENUM ('inbound','outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.message_status AS ENUM ('queued','sent','delivered','read','failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_flow_type AS ENUM ('lead_gen', 'receptionist');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.data_record_call_status AS ENUM ('needs_to_call','queued','calling','completed','failed','do_not_call');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. ALL TABLES (first pass — no RLS policies yet)
-- ============================================================

-- 2a. WORKSPACES
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2b. WORKSPACE MEMBERS
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON public.workspace_members(workspace_id);

-- 2c. WORKSPACE INVITES
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_token ON public.workspace_invites(token);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON public.workspace_invites(workspace_id);

-- 2d. WORKSPACE API TOKENS
CREATE TABLE IF NOT EXISTS public.workspace_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_api_tokens_workspace_id_idx ON public.workspace_api_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_api_tokens_token_hash_idx ON public.workspace_api_tokens(token_hash) WHERE revoked_at IS NULL;

-- 2e. WORKSPACE SETTINGS (merged from dash + builder workspace_calendar_settings)
CREATE TABLE IF NOT EXISTS public.workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  business_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_email TEXT,
  retell_workspace_id TEXT,
  retell_default_agent_id TEXT,
  calcom_api_key TEXT,
  calcom_api_token TEXT,
  calcom_event_type_id TEXT,
  calcom_webhook_secret TEXT,
  default_event_type_id BIGINT,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  min_notice_hours INTEGER NOT NULL DEFAULT 2,
  working_hours JSONB NOT NULL DEFAULT '{"mon":[["09:00","17:00"]],"tue":[["09:00","17:00"]],"wed":[["09:00","17:00"]],"thu":[["09:00","17:00"]],"fri":[["09:00","17:00"]],"sat":[],"sun":[]}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  whatsapp_provider TEXT,
  whatsapp_phone_id TEXT,
  twilio_auth_token TEXT,
  call_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2f. LEADS (from dash)
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  company_name TEXT,
  funding_amount NUMERIC(12,2),
  state_name TEXT,
  business_type TEXT,
  business_address TEXT,
  monthly_revenue NUMERIC(12,2),
  source public.lead_source NOT NULL DEFAULT 'inbound',
  type TEXT,
  status public.lead_status NOT NULL DEFAULT 'need_to_call',
  sentiment public.sentiment_kind,
  call_outcome TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  callback_requested BOOLEAN NOT NULL DEFAULT false,
  sent_to_underwriting BOOLEAN NOT NULL DEFAULT false,
  bank_statements_uploaded BOOLEAN NOT NULL DEFAULT false,
  bank_statements_status TEXT,
  missing_information TEXT,
  notes TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_workspace_id_idx ON public.leads(workspace_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(workspace_id, status);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON public.leads(phone);
CREATE INDEX IF NOT EXISTS leads_workspace_phone_idx ON public.leads(workspace_id, phone);

-- 2g. CALLS (from dash)
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  call_type public.call_type NOT NULL DEFAULT 'outbound',
  call_status public.call_status NOT NULL DEFAULT 'initiated',
  retell_call_id TEXT,
  agent_id TEXT,
  agent_name TEXT,
  from_number TEXT,
  to_number TEXT NOT NULL,
  duration_seconds INT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  disconnection_reason TEXT,
  call_outcome TEXT,
  call_successful BOOLEAN,
  in_voicemail BOOLEAN,
  sentiment public.sentiment_kind,
  transcript TEXT,
  call_summary TEXT,
  recording_url TEXT,
  cost_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_workspace_id_idx ON public.calls(workspace_id);
CREATE INDEX IF NOT EXISTS calls_lead_id_idx ON public.calls(lead_id);
CREATE INDEX IF NOT EXISTS calls_started_at_idx ON public.calls(workspace_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS calls_retell_call_id_key ON public.calls(retell_call_id) WHERE retell_call_id IS NOT NULL;

-- 2h. DATA RECORDS (from dash CSV campaigns)
CREATE TABLE IF NOT EXISTS public.data_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  mobile_number TEXT NOT NULL,
  email TEXT,
  client_name TEXT,
  unique_id TEXT,
  lead_external_id TEXT,
  property_type TEXT,
  bedrooms TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  need_to_call BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  assigned_agent_id UUID,
  scheduled_call_at TIMESTAMPTZ,
  call_status public.data_record_call_status NOT NULL DEFAULT 'needs_to_call',
  last_call_at TIMESTAMPTZ,
  last_call_outcome TEXT,
  last_call_sentiment TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_workspace_idx ON public.data_records(workspace_id);
CREATE INDEX IF NOT EXISTS data_mobile_idx ON public.data_records(workspace_id, mobile_number);
CREATE INDEX IF NOT EXISTS data_records_workspace_mobile_idx ON public.data_records(workspace_id, mobile_number);
CREATE INDEX IF NOT EXISTS data_records_call_status_idx ON public.data_records(workspace_id, call_status);
CREATE INDEX IF NOT EXISTS data_records_assigned_agent_idx ON public.data_records(workspace_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS data_records_scheduled_call_at_idx ON public.data_records(workspace_id, scheduled_call_at);

-- 2i. CALENDAR BOOKINGS (from dash)
CREATE TABLE IF NOT EXISTS public.calendar_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  description TEXT,
  attendee_name TEXT,
  attendee_email TEXT,
  attendee_phone TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  meeting_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_workspace_idx ON public.calendar_bookings(workspace_id);
CREATE INDEX IF NOT EXISTS bookings_start_idx ON public.calendar_bookings(workspace_id, start_at);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_bookings_workspace_external_idx ON public.calendar_bookings(workspace_id, external_id) WHERE external_id IS NOT NULL;

-- 2j. WHATSAPP MESSAGES (from dash)
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  external_id TEXT,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  direction public.message_direction NOT NULL,
  body TEXT,
  media_url TEXT,
  status public.message_status NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_workspace_idx ON public.whatsapp_messages(workspace_id);
CREATE INDEX IF NOT EXISTS wa_phone_idx ON public.whatsapp_messages(workspace_id, contact_phone, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_workspace_external_id_idx ON public.whatsapp_messages(workspace_id, external_id) WHERE external_id IS NOT NULL;

-- 2k. DEPLOYMENTS (from dash audit log)
CREATE TABLE IF NOT EXISTS public.deployments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'retell',
  provider_agent_id TEXT,
  provider_flow_id TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  payload JSONB,
  error TEXT,
  deployed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployments_agent ON public.deployments(agent_id);
CREATE INDEX IF NOT EXISTS idx_deployments_workspace ON public.deployments(workspace_id);

-- 2l. RETELL WEBHOOK EVENTS (from dash)
CREATE TABLE IF NOT EXISTS public.retell_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  retell_call_id TEXT,
  retell_agent_id TEXT,
  event_type TEXT NOT NULL,
  signature_valid BOOLEAN,
  processing_status TEXT NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS retell_webhook_events_workspace_received_idx ON public.retell_webhook_events(workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS retell_webhook_events_call_idx ON public.retell_webhook_events(retell_call_id);
CREATE INDEX IF NOT EXISTS retell_webhook_events_event_type_idx ON public.retell_webhook_events(event_type);

-- ============================================================
-- 3. GRANTS (for all tables above)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;

GRANT SELECT, INSERT, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_api_tokens TO authenticated;
GRANT ALL ON public.workspace_api_tokens TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_settings TO authenticated;
GRANT ALL ON public.workspace_settings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_records TO authenticated;
GRANT ALL ON public.data_records TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_bookings TO authenticated;
GRANT ALL ON public.calendar_bookings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

GRANT SELECT, INSERT ON public.deployments TO authenticated;
GRANT ALL ON public.deployments TO service_role;

GRANT SELECT ON public.retell_webhook_events TO authenticated;
GRANT ALL ON public.retell_webhook_events TO service_role;

-- ============================================================
-- 4. PROFILES: Add columns (needed by RLS helper functions below)
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS user_type public.user_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS default_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- Backfill user_type from existing user_roles
UPDATE public.profiles
SET user_type = 'admin'
WHERE user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin'::app_role)
  AND user_type = 'user';

-- ============================================================
-- 5. RLS HELPER FUNCTIONS
-- ============================================================

-- is_workspace_member: used in RLS policies on tenant tables
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

-- workspace_role_of: returns member's role in a workspace
CREATE OR REPLACE FUNCTION public.workspace_role_of(_workspace_id UUID, _user_id UUID)
RETURNS public.workspace_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.workspace_members
  WHERE workspace_id = _workspace_id AND user_id = _user_id
  LIMIT 1
$$;

-- is_platform_admin: used in RLS policies for platform-level admin gating
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND user_type = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_role_of(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;

-- ============================================================
-- 5. ROW LEVEL SECURITY (enable + policies for all new tables)
-- ============================================================

-- 5a. WORKSPACES
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspaces_select_members" ON public.workspaces;
CREATE POLICY "workspaces_select_members" ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(id, auth.uid()));

DROP POLICY IF EXISTS "workspaces_insert_self_owner" ON public.workspaces;
CREATE POLICY "workspaces_insert_self_owner" ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "workspaces_update_owner" ON public.workspaces;
CREATE POLICY "workspaces_update_owner" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "workspaces_delete_owner" ON public.workspaces;
CREATE POLICY "workspaces_delete_owner" ON public.workspaces
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 5b. WORKSPACE MEMBERS
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_select_same_workspace" ON public.workspace_members;
CREATE POLICY "members_select_same_workspace" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "members_insert_owner_admin" ON public.workspace_members;
CREATE POLICY "members_insert_owner_admin" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin')
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "members_update_owner_admin" ON public.workspace_members;
CREATE POLICY "members_update_owner_admin" ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS "members_delete_owner_admin_or_self" ON public.workspace_members;
CREATE POLICY "members_delete_owner_admin_or_self" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (
    public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin')
    OR user_id = auth.uid()
  );

-- 5c. WORKSPACE INVITES
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_select_workspace_admins" ON public.workspace_invites;
CREATE POLICY "invites_select_workspace_admins" ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS "invites_insert_workspace_admins" ON public.workspace_invites;
CREATE POLICY "invites_insert_workspace_admins" ON public.workspace_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin')
    AND invited_by = auth.uid()
  );

DROP POLICY IF EXISTS "invites_delete_workspace_admins" ON public.workspace_invites;
CREATE POLICY "invites_delete_workspace_admins" ON public.workspace_invites
  FOR DELETE TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

-- 5d. WORKSPACE API TOKENS
ALTER TABLE public.workspace_api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_tokens_select_admins" ON public.workspace_api_tokens;
CREATE POLICY "api_tokens_select_admins" ON public.workspace_api_tokens
  FOR SELECT TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS "api_tokens_insert_admins" ON public.workspace_api_tokens;
CREATE POLICY "api_tokens_insert_admins" ON public.workspace_api_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "api_tokens_update_admins" ON public.workspace_api_tokens;
CREATE POLICY "api_tokens_update_admins" ON public.workspace_api_tokens
  FOR UPDATE TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS "api_tokens_delete_admins" ON public.workspace_api_tokens;
CREATE POLICY "api_tokens_delete_admins" ON public.workspace_api_tokens
  FOR DELETE TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

-- 5e. WORKSPACE SETTINGS
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ws_settings_select_members" ON public.workspace_settings;
CREATE POLICY "ws_settings_select_members" ON public.workspace_settings
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "ws_settings_insert_admins" ON public.workspace_settings;
CREATE POLICY "ws_settings_insert_admins" ON public.workspace_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

DROP POLICY IF EXISTS "ws_settings_update_admins" ON public.workspace_settings;
CREATE POLICY "ws_settings_update_admins" ON public.workspace_settings
  FOR UPDATE TO authenticated
  USING (public.workspace_role_of(workspace_id, auth.uid()) IN ('owner','admin'));

-- 5f. LEADS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_workspace_members" ON public.leads;
CREATE POLICY "leads_select_workspace_members" ON public.leads
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "leads_insert_workspace_members" ON public.leads;
CREATE POLICY "leads_insert_workspace_members" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "leads_update_workspace_members" ON public.leads;
CREATE POLICY "leads_update_workspace_members" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "leads_delete_workspace_members" ON public.leads;
CREATE POLICY "leads_delete_workspace_members" ON public.leads
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- 5g. CALLS
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calls_select_workspace_members" ON public.calls;
CREATE POLICY "calls_select_workspace_members" ON public.calls
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "calls_insert_workspace_members" ON public.calls;
CREATE POLICY "calls_insert_workspace_members" ON public.calls
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "calls_update_workspace_members" ON public.calls;
CREATE POLICY "calls_update_workspace_members" ON public.calls
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "calls_delete_workspace_members" ON public.calls;
CREATE POLICY "calls_delete_workspace_members" ON public.calls
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- 5h. DATA RECORDS
ALTER TABLE public.data_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_select_workspace_members" ON public.data_records;
CREATE POLICY "data_select_workspace_members" ON public.data_records
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "data_insert_workspace_members" ON public.data_records;
CREATE POLICY "data_insert_workspace_members" ON public.data_records
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "data_update_workspace_members" ON public.data_records;
CREATE POLICY "data_update_workspace_members" ON public.data_records
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "data_delete_workspace_members" ON public.data_records;
CREATE POLICY "data_delete_workspace_members" ON public.data_records
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- 5i. CALENDAR BOOKINGS
ALTER TABLE public.calendar_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select_workspace_members" ON public.calendar_bookings;
CREATE POLICY "bookings_select_workspace_members" ON public.calendar_bookings
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "bookings_insert_workspace_members" ON public.calendar_bookings;
CREATE POLICY "bookings_insert_workspace_members" ON public.calendar_bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "bookings_update_workspace_members" ON public.calendar_bookings;
CREATE POLICY "bookings_update_workspace_members" ON public.calendar_bookings
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "bookings_delete_workspace_members" ON public.calendar_bookings;
CREATE POLICY "bookings_delete_workspace_members" ON public.calendar_bookings
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- 5j. WHATSAPP MESSAGES
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_select_workspace_members" ON public.whatsapp_messages;
CREATE POLICY "wa_select_workspace_members" ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_insert_workspace_members" ON public.whatsapp_messages;
CREATE POLICY "wa_insert_workspace_members" ON public.whatsapp_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_update_workspace_members" ON public.whatsapp_messages;
CREATE POLICY "wa_update_workspace_members" ON public.whatsapp_messages
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "wa_delete_workspace_members" ON public.whatsapp_messages;
CREATE POLICY "wa_delete_workspace_members" ON public.whatsapp_messages
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- 5k. DEPLOYMENTS
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deployments_select_workspace_members" ON public.deployments;
CREATE POLICY "deployments_select_workspace_members" ON public.deployments
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "deployments_insert_workspace_members" ON public.deployments;
CREATE POLICY "deployments_insert_workspace_members" ON public.deployments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()) AND deployed_by = auth.uid());

-- 5l. RETELL WEBHOOK EVENTS
ALTER TABLE public.retell_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retell_webhook_events_select_workspace_members" ON public.retell_webhook_events;
CREATE POLICY "retell_webhook_events_select_workspace_members" ON public.retell_webhook_events
  FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id, auth.uid()));

-- ============================================================
-- 6. Backfill: migrate builder workspace_calendar_settings
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspace_calendar_settings') THEN
    INSERT INTO public.workspace_settings (
      workspace_id, calcom_api_key, default_event_type_id,
      timezone, buffer_minutes, min_notice_hours, working_hours, last_synced_at
    )
    SELECT
      w.id,
      wcs.calcom_api_key,
      wcs.default_event_type_id,
      wcs.timezone,
      wcs.buffer_minutes,
      wcs.min_notice_hours,
      wcs.working_hours,
      wcs.last_synced_at
    FROM public.workspace_calendar_settings wcs
    JOIN public.workspaces w ON w.owner_id = wcs.user_id
    ON CONFLICT (workspace_id) DO NOTHING;

    DROP TABLE IF EXISTS public.workspace_calendar_settings CASCADE;
  END IF;
END;
$$;

-- ============================================================
-- 8. AGENTS: Add workspace_id and dash columns
-- ============================================================
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_type public.agent_flow_type NOT NULL DEFAULT 'receptionist',
  ADD COLUMN IF NOT EXISTS inbound_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS retell_conversation_flow_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON public.agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_agent_type ON public.agents(agent_type);
CREATE INDEX IF NOT EXISTS idx_agents_inbound_phone ON public.agents(inbound_phone_number);

-- ============================================================
-- 9. Add workspace_id to existing tenant tables
-- ============================================================
ALTER TABLE public.agent_templates
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS agent_templates_workspace_idx ON public.agent_templates(workspace_id);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON public.subscriptions(workspace_id);

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_usage_events_workspace ON public.usage_events(workspace_id);

ALTER TABLE public.calendar_connections
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cc_workspace_idx ON public.calendar_connections(workspace_id);

ALTER TABLE public.calcom_event_types
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cet_workspace_idx ON public.calcom_event_types(workspace_id);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS bk_workspace_idx ON public.bookings(workspace_id);

ALTER TABLE public.booking_summaries
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_booking_summaries_workspace ON public.booking_summaries(workspace_id);

-- ============================================================
-- 10. Drop dashboard_sync_settings (no longer needed)
-- ============================================================
DROP TABLE IF EXISTS public.dashboard_sync_settings CASCADE;

-- ============================================================
-- 11. Update trigger function for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ SET search_path = public;

-- ============================================================
-- 12. Triggers on new tables
-- ============================================================
DROP TRIGGER IF EXISTS trg_workspaces_updated ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_ws_settings_updated ON public.workspace_settings;
CREATE TRIGGER trg_ws_settings_updated BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_leads_updated ON public.leads;
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_calls_updated ON public.calls;
CREATE TRIGGER trg_calls_updated BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_data_records_updated ON public.data_records;
CREATE TRIGGER trg_data_records_updated BEFORE UPDATE ON public.data_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_calendar_bookings_updated ON public.calendar_bookings;
CREATE TRIGGER trg_calendar_bookings_updated BEFORE UPDATE ON public.calendar_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 13. Updated RLS for profiles (use is_platform_admin)
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ============================================================
-- 14. Auto-provision trigger (replaces approval-gated handle_new_user)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _workspace_id UUID;
  _slug TEXT;
BEGIN
  -- Create profile (no approval gate)
  INSERT INTO public.profiles (user_id, email, full_name, user_type)
  VALUES (NEW.id, NEW.email, NULL, 'user');

  -- Create personal workspace
  _slug := lower(regexp_replace(coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)), '[^a-z0-9]', '-', 'g'));
  IF length(_slug) < 3 THEN
    _slug := 'user-' || substr(NEW.id::text, 1, 8);
  END IF;
  _slug := _slug || '-' || substr(NEW.id::text, 1, 6);
  _slug := left(_slug, 63);

  INSERT INTO public.workspaces (name, slug, owner_id)
  VALUES (
    coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)) || '''s Workspace',
    _slug,
    NEW.id
  )
  RETURNING id INTO _workspace_id;

  -- Add as owner
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (_workspace_id, NEW.id, 'owner');

  -- Create default workspace settings
  INSERT INTO public.workspace_settings (workspace_id, business_name)
  VALUES (_workspace_id, coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)));

  -- Set default_workspace_id on profile
  UPDATE public.profiles
  SET default_workspace_id = _workspace_id
  WHERE user_id = NEW.id;

  RETURN NEW;
END;
$$;
