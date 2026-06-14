-- GrowthMind Phase 2: AI CMO — Ads, Funnels, Playbooks, SEO, Competitors, Forecast
-- Apply in Supabase SQL Editor

-- ── Tables ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS growthmind_ads_accounts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform       TEXT        NOT NULL CHECK (platform IN ('google','meta','linkedin','tiktok')),
  label          TEXT        NOT NULL,
  account_id     TEXT        NOT NULL,
  -- token stored encrypted; never returned raw to clients
  token_enc      TEXT,
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','disconnected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_campaigns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ads_account_id  UUID        REFERENCES growthmind_ads_accounts(id) ON DELETE CASCADE,
  platform        TEXT        NOT NULL CHECK (platform IN ('google','meta','linkedin','tiktok')),
  name            TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  spend           NUMERIC     NOT NULL DEFAULT 0,
  impressions     BIGINT      NOT NULL DEFAULT 0,
  clicks          BIGINT      NOT NULL DEFAULT 0,
  conversions     BIGINT      NOT NULL DEFAULT 0,
  cpl             NUMERIC     GENERATED ALWAYS AS (
                    CASE WHEN conversions > 0 THEN spend / conversions ELSE NULL END
                  ) STORED,
  roas            NUMERIC,
  period_start    DATE,
  period_end      DATE,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_playbooks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  industry     TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_funnels (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL DEFAULT 'Funnel Snapshot',
  stages       JSONB       NOT NULL DEFAULT '[]',
  snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_forecasts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scenario     TEXT        NOT NULL DEFAULT 'base' CHECK (scenario IN ('conservative','base','optimistic')),
  period_weeks INTEGER     NOT NULL DEFAULT 12,
  deal_value   NUMERIC     NOT NULL DEFAULT 0,
  currency     TEXT        NOT NULL DEFAULT 'GBP',
  buckets      JSONB       NOT NULL DEFAULT '[]',
  summary      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_competitors (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  website             TEXT,
  services            TEXT,
  offers              TEXT,
  positioning         TEXT,
  observations        TEXT,
  ai_analysis         TEXT,
  ai_analysed_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS growthmind_seo_sites (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  keywords        JSONB       NOT NULL DEFAULT '[]',
  content_ideas   JSONB       NOT NULL DEFAULT '[]',
  ai_recs         JSONB       NOT NULL DEFAULT '[]',
  ai_rec_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS gm_ads_accounts_ws ON growthmind_ads_accounts (workspace_id, platform);
CREATE INDEX IF NOT EXISTS gm_campaigns_ws    ON growthmind_campaigns    (workspace_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_campaigns_acct  ON growthmind_campaigns    (ads_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_playbooks_ws    ON growthmind_playbooks    (workspace_id, status, activated_at DESC);
CREATE INDEX IF NOT EXISTS gm_funnels_ws      ON growthmind_funnels      (workspace_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS gm_forecasts_ws    ON growthmind_forecasts    (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_competitors_ws  ON growthmind_competitors  (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gm_seo_sites_ws    ON growthmind_seo_sites    (workspace_id);

-- ── Row Level Security ──────────────────────────────────────────────────────────

ALTER TABLE growthmind_ads_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_playbooks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_funnels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_forecasts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_competitors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE growthmind_seo_sites    ENABLE ROW LEVEL SECURITY;

-- Helper macro (repeated inline — no function needed)
-- Pattern: workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())

-- growthmind_ads_accounts
CREATE POLICY "gm_ads_accounts_select" ON growthmind_ads_accounts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_ads_accounts_insert" ON growthmind_ads_accounts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_ads_accounts_update" ON growthmind_ads_accounts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_ads_accounts_delete" ON growthmind_ads_accounts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_campaigns
CREATE POLICY "gm_campaigns_select" ON growthmind_campaigns FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_campaigns_insert" ON growthmind_campaigns FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_campaigns_update" ON growthmind_campaigns FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_campaigns_delete" ON growthmind_campaigns FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_playbooks
CREATE POLICY "gm_playbooks_select" ON growthmind_playbooks FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_playbooks_insert" ON growthmind_playbooks FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_playbooks_update" ON growthmind_playbooks FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_playbooks_delete" ON growthmind_playbooks FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_funnels
CREATE POLICY "gm_funnels_select" ON growthmind_funnels FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_funnels_insert" ON growthmind_funnels FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_funnels_update" ON growthmind_funnels FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_funnels_delete" ON growthmind_funnels FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_forecasts
CREATE POLICY "gm_forecasts_select" ON growthmind_forecasts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_forecasts_insert" ON growthmind_forecasts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_forecasts_update" ON growthmind_forecasts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_forecasts_delete" ON growthmind_forecasts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_competitors
CREATE POLICY "gm_competitors_select" ON growthmind_competitors FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_competitors_insert" ON growthmind_competitors FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_competitors_update" ON growthmind_competitors FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_competitors_delete" ON growthmind_competitors FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_seo_sites
CREATE POLICY "gm_seo_sites_select" ON growthmind_seo_sites FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_seo_sites_insert" ON growthmind_seo_sites FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_seo_sites_update" ON growthmind_seo_sites FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "gm_seo_sites_delete" ON growthmind_seo_sites FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
