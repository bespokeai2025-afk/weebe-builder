-- Seat billing extension for Executive Suite, Business Command, Enterprise tiers.
-- Safe to apply: all new columns are nullable with defaults, no existing columns touched.
-- Apply manually in Supabase SQL Editor.

-- ── workspace_seat_billing ───────────────────────────────────────────────────
-- Stores the seat configuration for a workspace subscription.
-- One row per workspace; upserted when a workspace upgrades to a seat-based plan.

CREATE TABLE IF NOT EXISTS public.workspace_seat_billing (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_tier                   TEXT        NOT NULL, -- 'executive_suite' | 'business_command' | 'enterprise'
  included_users              INTEGER     NOT NULL DEFAULT 5,
  additional_user_price_pence INTEGER     NOT NULL DEFAULT 3900, -- pence per extra user per month
  current_user_count          INTEGER     NOT NULL DEFAULT 0,
  seat_limit_warning_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.80, -- warn at 80% utilisation
  custom_seat_price_override  INTEGER     NULL, -- platform admin override
  notes                       TEXT        NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_seat_billing_workspace_id_unique UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS workspace_seat_billing_workspace_id_idx
  ON public.workspace_seat_billing(workspace_id);

-- RLS: workspace members can read; only platform service role writes
ALTER TABLE public.workspace_seat_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seat_billing_workspace_read" ON public.workspace_seat_billing;
CREATE POLICY "seat_billing_workspace_read" ON public.workspace_seat_billing
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- ── seat_overage_events ──────────────────────────────────────────────────────
-- Ledger of seat overage charges so AccountsMind can report seat revenue.

CREATE TABLE IF NOT EXISTS public.seat_overage_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_period    DATE        NOT NULL, -- first day of month this covers
  included_users    INTEGER     NOT NULL,
  active_users      INTEGER     NOT NULL,
  extra_users       INTEGER     NOT NULL GENERATED ALWAYS AS (GREATEST(active_users - included_users, 0)) STORED,
  price_per_user_pence INTEGER  NOT NULL,
  total_pence       INTEGER     NOT NULL GENERATED ALWAYS AS (GREATEST(active_users - included_users, 0) * price_per_user_pence) STORED,
  stripe_invoice_item_id TEXT   NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seat_overage_events_workspace_idx
  ON public.seat_overage_events(workspace_id, billing_period);

ALTER TABLE public.seat_overage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seat_overage_workspace_read" ON public.seat_overage_events;
CREATE POLICY "seat_overage_workspace_read" ON public.seat_overage_events
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- ── Helper view: seat_utilisation ────────────────────────────────────────────
-- Joins live member count so the app can read utilisation in one query.

CREATE OR REPLACE VIEW public.seat_utilisation AS
SELECT
  sb.workspace_id,
  sb.plan_tier,
  sb.included_users,
  sb.additional_user_price_pence,
  sb.seat_limit_warning_threshold,
  COALESCE(member_counts.active_count, 0)                             AS active_users,
  GREATEST(COALESCE(member_counts.active_count, 0) - sb.included_users, 0) AS extra_users,
  ROUND(
    COALESCE(member_counts.active_count, 0)::NUMERIC / NULLIF(sb.included_users, 0),
    4
  )                                                                   AS utilisation_ratio,
  CASE
    WHEN COALESCE(member_counts.active_count, 0) >= sb.included_users THEN true
    ELSE false
  END                                                                 AS is_over_limit,
  CASE
    WHEN COALESCE(member_counts.active_count, 0)::NUMERIC / NULLIF(sb.included_users, 0)
         >= sb.seat_limit_warning_threshold THEN true
    ELSE false
  END                                                                 AS warning_active
FROM public.workspace_seat_billing sb
LEFT JOIN (
  SELECT workspace_id, COUNT(*) AS active_count
  FROM public.workspace_members
  GROUP BY workspace_id
) member_counts ON member_counts.workspace_id = sb.workspace_id;
