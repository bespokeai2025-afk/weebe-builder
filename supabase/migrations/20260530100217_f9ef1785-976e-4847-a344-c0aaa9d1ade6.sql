
CREATE TABLE public.booking_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  agent_id uuid,
  retell_agent_id text,
  call_id text NOT NULL UNIQUE,
  booking_id uuid,
  calcom_booking_uid text,
  summary text,
  appointment_reason text,
  customer_name text,
  customer_phone text,
  appointment_date text,
  appointment_booked boolean DEFAULT false,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.booking_summaries TO authenticated;
GRANT ALL ON public.booking_summaries TO service_role;

ALTER TABLE public.booking_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bs select own" ON public.booking_summaries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_booking_summaries_user ON public.booking_summaries(user_id);
CREATE INDEX idx_booking_summaries_agent ON public.booking_summaries(agent_id);
CREATE INDEX idx_booking_summaries_call ON public.booking_summaries(call_id);

CREATE TRIGGER touch_booking_summaries_updated_at
  BEFORE UPDATE ON public.booking_summaries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
