-- ── Shadow testing for the WEBEE native voice engine ──────────────────────────
-- Before an agent is cut over from Retell, its past Retell calls are replayed
-- through the native conversation graph VM and the two agent-side transcripts are
-- compared. One row per replayed call.
--
-- The comparison is deliberately stored rather than computed on demand: the
-- reference call's transcript can be edited or purged, and a cutover decision has
-- to be auditable after the fact.

CREATE TABLE IF NOT EXISTS public.voice_shadow_runs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL,
  agent_id               UUID NOT NULL,
  -- The Retell call replayed, so a run can be traced back to real audio.
  reference_call_id      TEXT,
  reference_engine       TEXT NOT NULL DEFAULT 'retell',
  user_turn_count        INTEGER NOT NULL DEFAULT 0,
  reference_agent_turns  INTEGER NOT NULL DEFAULT 0,
  candidate_agent_turns  INTEGER NOT NULL DEFAULT 0,
  average_similarity     DECIMAL(6,4) NOT NULL DEFAULT 0,
  -- 1-based index of the first agent turn that diverged; null when none did.
  diverged_at_turn       INTEGER,
  verdict                TEXT NOT NULL DEFAULT 'divergent',
  diff                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_transcript   TEXT,
  node_path              JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings               JSONB NOT NULL DEFAULT '[]'::jsonb,
  error                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_shadow_runs_agent
  ON public.voice_shadow_runs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_shadow_runs_workspace
  ON public.voice_shadow_runs(workspace_id, created_at DESC);

ALTER TABLE public.voice_shadow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_shadow_runs_members" ON public.voice_shadow_runs
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- Runs are only ever written by the server function that performs the replay.
REVOKE INSERT, UPDATE, DELETE ON public.voice_shadow_runs FROM authenticated;
GRANT SELECT ON public.voice_shadow_runs TO authenticated;
GRANT ALL ON public.voice_shadow_runs TO service_role;
