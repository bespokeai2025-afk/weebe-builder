-- Microsoft Clarity integration + Website Change Queue (additive, idempotent).
-- 1. clarity_metrics_daily: workspace-scoped daily behavioural metrics ingested
--    from Clarity's Data Export API (URL x Device breakdown, jsonb metrics —
--    the API exposes aggregate counts only, never session recordings).
-- 2. website_change_queue: evidence-backed UX change recommendations. Every
--    row carries the full CURRENT/PROPOSED/WHY/DATA/IMPACT/RISK/ROLLBACK
--    structure and executes approval-first via the Marketing Action Engine.
-- Both tables are server-write-only (members SELECT via RLS).

CREATE TABLE IF NOT EXISTS public.clarity_metrics_daily (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  metric_date    date NOT NULL,
  url            text NOT NULL,
  device         text NOT NULL DEFAULT '',
  sessions       numeric NOT NULL DEFAULT 0,
  distinct_users numeric NOT NULL DEFAULT 0,
  bot_sessions   numeric NOT NULL DEFAULT 0,
  metrics        jsonb NOT NULL DEFAULT '{}'::jsonb, -- deadClicks, rageClicks, excessiveScroll, quickbackClicks, scriptErrors, errorClicks, engagementTime, scrollDepth
  raw            jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clarity_metrics_daily_key
  ON public.clarity_metrics_daily (workspace_id, metric_date, url, device);
CREATE INDEX IF NOT EXISTS idx_clarity_metrics_ws_date
  ON public.clarity_metrics_daily (workspace_id, metric_date DESC);

ALTER TABLE public.clarity_metrics_daily ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='clarity_metrics_members_select'
      AND polrelid='public.clarity_metrics_daily'::regclass) THEN
    CREATE POLICY clarity_metrics_members_select ON public.clarity_metrics_daily
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE ALL ON public.clarity_metrics_daily FROM authenticated;
REVOKE ALL ON public.clarity_metrics_daily FROM anon;
GRANT SELECT ON public.clarity_metrics_daily TO authenticated;

CREATE TABLE IF NOT EXISTS public.website_change_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  page_url            text NOT NULL,
  change_type         text NOT NULL CHECK (change_type IN (
                        'headline','cta_copy','cta_position','section_order','social_proof',
                        'pricing_presentation','form_optimisation','ava_positioning','landing_content','faq')),
  title               text NOT NULL,
  current_state       text NOT NULL,
  proposed_state      text NOT NULL,
  why                 text NOT NULL,
  supporting_data     jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_impact     text NOT NULL,
  risk                text NOT NULL,
  rollback_plan       text NOT NULL,
  confidence          numeric NOT NULL DEFAULT 0,
  score               numeric NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','executing','handled','dismissed','expired')),
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  dedupe_key          text NOT NULL,
  marketing_action_id uuid,
  package_id          uuid,
  measurement         jsonb,
  first_detected_at   timestamptz NOT NULL DEFAULT now(),
  last_detected_at    timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Live statuses cannot duplicate; dismissed/expired rows fall out of the index
-- so a change can be re-proposed later.
CREATE UNIQUE INDEX IF NOT EXISTS uq_website_change_queue_dedupe_live
  ON public.website_change_queue (workspace_id, dedupe_key)
  WHERE status IN ('open','executing','handled');
CREATE INDEX IF NOT EXISTS idx_website_change_queue_ws_status_score
  ON public.website_change_queue (workspace_id, status, score DESC);

ALTER TABLE public.website_change_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='website_change_queue_members_select'
      AND polrelid='public.website_change_queue'::regclass) THEN
    CREATE POLICY website_change_queue_members_select ON public.website_change_queue
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;
REVOKE ALL ON public.website_change_queue FROM authenticated;
REVOKE ALL ON public.website_change_queue FROM anon;
GRANT SELECT ON public.website_change_queue TO authenticated;
