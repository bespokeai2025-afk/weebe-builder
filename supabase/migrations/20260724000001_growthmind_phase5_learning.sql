-- ─────────────────────────────────────────────────────────────────────────────
-- GrowthMind Phase 5 — performance learning engine.
--
--   growthmind_learned_patterns — patterns GrowthMind derives from THIS
--   workspace's own published-content results (best hooks/formats/times,
--   formats that get views but no leads, declining topics). Every pattern is
--   PROPOSED and only affects future recommendation scoring once a human
--   ACCEPTS it. DNA-affecting learnings go through the existing
--   growthmind_dna_proposals accept/reject table — Business DNA is never
--   silently rewritten.
--
-- Retention: stateful decision table (accepted patterns steer live scoring) —
-- intentionally NOT in RETENTION_RULES; superseded rows get status 'expired'.
--
-- Additive + idempotent: safe to re-run. Apply via
-- scripts/apply-growthmind-phase5-learning-migration.mjs or the SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.growthmind_learned_patterns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  pattern_kind  TEXT NOT NULL
                CHECK (pattern_kind IN (
                  'winning_format','losing_format','views_no_leads','winning_hook',
                  'best_publish_window','declining_topic','winning_cta','other')),
  pattern_key   TEXT NOT NULL,                        -- e.g. format:reel, hour:18
  insight       TEXT NOT NULL,                        -- human-readable summary
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- sample metrics backing it
  adjustment    NUMERIC NOT NULL DEFAULT 0,           -- bounded scoring delta (-0.2 .. +0.2)
  sample_size   INTEGER NOT NULL DEFAULT 0,
  confidence    NUMERIC NOT NULL DEFAULT 0,           -- 0..1
  status        TEXT NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed','accepted','rejected','expired')),
  resolved_by_user_id UUID,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One LIVE (proposed or accepted) pattern per (workspace, kind, key) — the
-- learning tick inserts row-by-row and treats 23505 as "already known".
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_learned_live
  ON public.growthmind_learned_patterns (workspace_id, pattern_kind, pattern_key)
  WHERE status IN ('proposed','accepted');

CREATE INDEX IF NOT EXISTS idx_gm_learned_ws
  ON public.growthmind_learned_patterns (workspace_id, status, created_at DESC);

ALTER TABLE public.growthmind_learned_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_learned_members" ON public.growthmind_learned_patterns;
CREATE POLICY "gm_learned_members" ON public.growthmind_learned_patterns
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
REVOKE ALL ON TABLE public.growthmind_learned_patterns FROM authenticated, anon;
GRANT SELECT ON public.growthmind_learned_patterns TO authenticated;
