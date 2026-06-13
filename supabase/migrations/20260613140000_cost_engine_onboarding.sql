-- ── Cost Engine: Onboarding & Client Estimates ─────────────────────────────
-- Dev role rates and per-client profitability estimates. Admin-only, service role access.

CREATE TABLE IF NOT EXISTS public.cost_engine_dev_roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name      TEXT NOT NULL,
  rate_per_hour  NUMERIC(10,2) NOT NULL DEFAULT 0,
  hours_per_week INT NOT NULL DEFAULT 40,
  notes          TEXT,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cost_engine_client_estimates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name           TEXT NOT NULL,
  client_email          TEXT,
  plan_id               UUID REFERENCES public.cost_engine_customer_plans(id) ON DELETE SET NULL,
  project_weeks         INT NOT NULL DEFAULT 4,
  team_config           JSONB NOT NULL DEFAULT '[]',
  monthly_addon_charges JSONB NOT NULL DEFAULT '[]',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_engine_dev_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_engine_client_estimates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cost_engine_dev_roles (role_name, rate_per_hour, hours_per_week, sort_order) VALUES
  ('Junior Developer',    35.00, 40, 0),
  ('Mid-Level Developer', 65.00, 40, 1),
  ('Senior Developer',   100.00, 40, 2),
  ('QA Engineer',         45.00, 40, 3);
