
-- 1. workspace_calendar_settings
CREATE TABLE public.workspace_calendar_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  calcom_api_key text,
  default_event_type_id bigint,
  timezone text NOT NULL DEFAULT 'UTC',
  buffer_minutes integer NOT NULL DEFAULT 0,
  min_notice_hours integer NOT NULL DEFAULT 2,
  working_hours jsonb NOT NULL DEFAULT '{"mon":[["09:00","17:00"]],"tue":[["09:00","17:00"]],"wed":[["09:00","17:00"]],"thu":[["09:00","17:00"]],"fri":[["09:00","17:00"]],"sat":[],"sun":[]}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_calendar_settings TO authenticated;
GRANT ALL ON public.workspace_calendar_settings TO service_role;
ALTER TABLE public.workspace_calendar_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wcs select own" ON public.workspace_calendar_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wcs insert own" ON public.workspace_calendar_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wcs update own" ON public.workspace_calendar_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wcs delete own" ON public.workspace_calendar_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER wcs_touch BEFORE UPDATE ON public.workspace_calendar_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. calendar_connections
CREATE TABLE public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google',
  calcom_credential_id bigint,
  external_id text NOT NULL,
  email text,
  name text,
  is_availability boolean NOT NULL DEFAULT true,
  is_primary_booking boolean NOT NULL DEFAULT false,
  read_only boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, external_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_connections TO authenticated;
GRANT ALL ON public.calendar_connections TO service_role;
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc select own" ON public.calendar_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cc insert own" ON public.calendar_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cc update own" ON public.calendar_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cc delete own" ON public.calendar_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER cc_touch BEFORE UPDATE ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX cc_user_idx ON public.calendar_connections(user_id);

-- 3. calcom_event_types
CREATE TABLE public.calcom_event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  calcom_event_type_id bigint NOT NULL,
  title text NOT NULL,
  slug text,
  length_minutes integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, calcom_event_type_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calcom_event_types TO authenticated;
GRANT ALL ON public.calcom_event_types TO service_role;
ALTER TABLE public.calcom_event_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cet select own" ON public.calcom_event_types FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cet insert own" ON public.calcom_event_types FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cet update own" ON public.calcom_event_types FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cet delete own" ON public.calcom_event_types FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER cet_touch BEFORE UPDATE ON public.calcom_event_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX cet_user_idx ON public.calcom_event_types(user_id);

-- 4. bookings
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  calcom_booking_id bigint,
  calcom_booking_uid text,
  event_type_id bigint,
  attendee_name text,
  attendee_email text,
  attendee_phone text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  retell_call_id text,
  notes text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bk select own" ON public.bookings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bk insert own" ON public.bookings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bk update own" ON public.bookings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "bk delete own" ON public.bookings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER bk_touch BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX bk_user_idx ON public.bookings(user_id);
CREATE INDEX bk_agent_idx ON public.bookings(agent_id);
CREATE INDEX bk_start_idx ON public.bookings(start_at);
