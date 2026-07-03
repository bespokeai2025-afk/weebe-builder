-- Live call sessions: transient, per-call LIVE transcript snapshots captured
-- during an in-progress Retell call via the `transcript_updated` webhook event.
--
-- This is DISPLAY-ONLY state for the dashboard Live Calls panel. It is separate
-- from the `calls` table (the canonical post-call record) — nothing here feeds
-- analytics, leads, HiveMind/GrowthMind/SystemMind, or webhook logic. Rows are
-- upserted while the call is active and marked ended (then cleaned up) afterward.
--
-- `transcript_updated` delivers the FULL cumulative transcript each time, so we
-- store a single snapshot per call (UNIQUE workspace_id+retell_call_id) rather
-- than per-utterance deltas — this is inherently dedup-free.
CREATE TABLE IF NOT EXISTS public.live_call_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  retell_call_id  text NOT NULL,
  agent_id        text,
  agent_name      text,
  from_number     text,
  to_number       text,
  direction       text,
  call_type       text,
  call_status     text NOT NULL DEFAULT 'in_progress', -- ringing | in_progress | ended | failed
  transcript      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ role: 'agent'|'user', content }]
  transcript_len  integer NOT NULL DEFAULT 0,          -- guard against out-of-order webhook regression
  started_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_call_sessions_ws_call_unique UNIQUE (workspace_id, retell_call_id)
);

CREATE INDEX IF NOT EXISTS live_call_sessions_ws_updated_idx
  ON public.live_call_sessions (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS live_call_sessions_ws_status_idx
  ON public.live_call_sessions (workspace_id, call_status);

-- Defense-in-depth: SSE reads go through the service-role client (bypasses RLS),
-- but enable workspace-scoped RLS so any client-side read is tenant-isolated.
ALTER TABLE public.live_call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_live_call_sessions" ON public.live_call_sessions;
CREATE POLICY "workspace_live_call_sessions" ON public.live_call_sessions
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
