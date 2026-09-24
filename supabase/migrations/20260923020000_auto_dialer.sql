-- Auto Dialer: dials a list of real numbers one at a time, and on each answer
-- rings two real people simultaneously, bridging whichever picks up first.
--
-- Deliberately separate from `campaigns` (the AI-agent outbound engine) — this
-- bridges two humans, never an agent, and reusing that table would mix a
-- human-to-human feature into AI-campaign reporting and the executor cron.

CREATE TABLE IF NOT EXISTS public.dialer_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  name               text        NOT NULL,
  status             text        NOT NULL DEFAULT 'draft',
  -- draft | running | paused | completed | cancelled
  from_number        text        NOT NULL,           -- our Twilio number placing the calls
  route_numbers      jsonb       NOT NULL DEFAULT '[]', -- the 2 real people, e.g. ["+9715...","+9715..."]
  ring_timeout_secs  integer     NOT NULL DEFAULT 20, -- how long the 2 route numbers ring before we give up
  stats              jsonb       NOT NULL DEFAULT '{"total":0,"dialed":0,"bridged":0,"no_answer":0,"failed":0}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dialer_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members manage dialer_sessions"
    ON public.dialer_sessions FOR ALL
    USING (workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.dialer_targets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid        NOT NULL REFERENCES public.dialer_sessions(id) ON DELETE CASCADE,
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  position       integer     NOT NULL,       -- dial order within the session
  name           text,
  phone          text        NOT NULL,       -- E.164
  status         text        NOT NULL DEFAULT 'pending',
  -- pending | dialing | ringing | bridged | no_answer | busy | failed | completed
  call_sid       text,                       -- the leg to this target (the lead)
  bridged_number text,                       -- whichever of the 2 route numbers actually answered
  attempt_count  integer     NOT NULL DEFAULT 0,
  started_at     timestamptz,
  ended_at       timestamptz,
  duration_secs  integer,
  -- Set the instant either webhook (Dial-result or lead call-status) claims the
  -- right to advance the queue to the next target. Both webhooks can fire for
  -- the same target; this is the guard that stops the queue double-advancing.
  advanced_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_targets_session_position
  ON public.dialer_targets (session_id, position);
CREATE INDEX IF NOT EXISTS idx_dialer_targets_call_sid
  ON public.dialer_targets (call_sid) WHERE call_sid IS NOT NULL;

ALTER TABLE public.dialer_targets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workspace members manage dialer_targets"
    ON public.dialer_targets FOR ALL
    USING (workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- No anon/public policy: the webhook routes below write through the
-- service-role client, same as telephony_calls / call_events.
