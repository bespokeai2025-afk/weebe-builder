-- ─────────────────────────────────────────────────────────────────────────────
-- AccountsMind metric snapshots — daily per-workspace metric values so trend /
-- progress widgets can render real series instead of a single point-in-time
-- number.
--
-- Populated server-side only (service role): opportunistically whenever
-- computeMetricsServer runs for a workspace (client dashboard views, admin
-- config views) and on every SystemMind health-check run. One row per
-- (workspace, metric, UTC day) — upserts keep it idempotent.
--
-- Additive + idempotent: safe to re-run. Apply manually to the shared Supabase
-- DB (Management API via scripts/apply-accountsmind-metric-snapshots-migration.mjs,
-- or the SQL Editor).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accountsmind_metric_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  metric_key    TEXT NOT NULL,
  captured_on   DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')::date,
  value         NUMERIC NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_am_metric_snapshots_ws_key_day
  ON public.accountsmind_metric_snapshots (workspace_id, metric_key, captured_on);
CREATE INDEX IF NOT EXISTS idx_am_metric_snapshots_ws_key_day
  ON public.accountsmind_metric_snapshots (workspace_id, metric_key, captured_on DESC);

ALTER TABLE public.accountsmind_metric_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "am_metric_snapshots_members" ON public.accountsmind_metric_snapshots;
CREATE POLICY "am_metric_snapshots_members" ON public.accountsmind_metric_snapshots
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- Server-write-only: revoke everything, grant back SELECT only (default grants
-- would otherwise leave TRUNCATE/REFERENCES/TRIGGER to authenticated).
REVOKE ALL ON TABLE public.accountsmind_metric_snapshots FROM authenticated, anon;
GRANT SELECT ON public.accountsmind_metric_snapshots TO authenticated;
