-- Module gating + white label partners
-- Apply manually in Supabase SQL Editor.

-- ── 1. Add module columns to workspace_settings ──────────────────────────────
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS plan_tier          TEXT        NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS active_modules     TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS modules_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 2. Module upgrade requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.module_upgrade_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by  UUID        NOT NULL REFERENCES auth.users(id),
  module_id     TEXT        NOT NULL,
  module_name   TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending', -- pending | approved | denied
  notes         TEXT,
  reviewed_by   UUID        REFERENCES auth.users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS module_requests_workspace_idx
  ON public.module_upgrade_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS module_requests_status_idx
  ON public.module_upgrade_requests(status, created_at DESC);

ALTER TABLE public.module_upgrade_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "module_requests_workspace_read" ON public.module_upgrade_requests;
CREATE POLICY "module_requests_workspace_read" ON public.module_upgrade_requests
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "module_requests_workspace_insert" ON public.module_upgrade_requests;
CREATE POLICY "module_requests_workspace_insert" ON public.module_upgrade_requests
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- ── 3. White label partners ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whitelabel_partners (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        REFERENCES public.workspaces(id) ON DELETE SET NULL,
  partner_name        TEXT        NOT NULL,
  slug                TEXT        NOT NULL UNIQUE,
  custom_domain       TEXT,
  logo_url            TEXT,
  favicon_url         TEXT,
  primary_color       TEXT        NOT NULL DEFAULT '#F5B800',
  secondary_color     TEXT        NOT NULL DEFAULT '#050e1e',
  accent_color        TEXT        NOT NULL DEFAULT '#3b82f6',
  brand_name          TEXT        NOT NULL,
  tagline             TEXT,
  support_email       TEXT,
  support_url         TEXT,
  hide_powered_by     BOOLEAN     NOT NULL DEFAULT false,
  custom_css          TEXT,
  allowed_modules     TEXT[]      NOT NULL DEFAULT '{}',
  partner_tier        TEXT        NOT NULL DEFAULT 'standard', -- standard | premium | enterprise
  monthly_fee_pence   INTEGER     NOT NULL DEFAULT 0,
  revenue_share_pct   NUMERIC(5,2) DEFAULT 0,
  active              BOOLEAN     NOT NULL DEFAULT true,
  notes               TEXT,
  onboarded_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whitelabel_partners_workspace_idx
  ON public.whitelabel_partners(workspace_id);
CREATE INDEX IF NOT EXISTS whitelabel_partners_slug_idx
  ON public.whitelabel_partners(slug);
CREATE INDEX IF NOT EXISTS whitelabel_partners_active_idx
  ON public.whitelabel_partners(active);

-- Admin-only: RLS blocks all direct client access; service_role handles reads/writes
ALTER TABLE public.whitelabel_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whitelabel_admin_all" ON public.whitelabel_partners;
CREATE POLICY "whitelabel_admin_all" ON public.whitelabel_partners
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
