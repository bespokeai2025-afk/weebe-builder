-- ─────────────────────────────────────────────────────────────────────────────
-- GrowthMind SEO + Email Campaign Engine Migration
-- Apply via the Supabase SQL Editor (Project → SQL Editor → New Query).
-- All statements use CREATE TABLE IF NOT EXISTS for idempotent re-runs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. growthmind_seo_briefs ──────────────────────────────────────────────────
-- AI-generated on-page SEO briefs per URL/page.

CREATE TABLE IF NOT EXISTS growthmind_seo_briefs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  url           TEXT NOT NULL,
  page_title    TEXT,
  brief         TEXT NOT NULL,
  target_kws    TEXT[] NOT NULL DEFAULT '{}',
  word_count    INTEGER,
  meta_title    TEXT,
  meta_desc     TEXT,
  score         INTEGER,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_seo_briefs_workspace
  ON growthmind_seo_briefs (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_seo_briefs_generated
  ON growthmind_seo_briefs (workspace_id, generated_at DESC);

ALTER TABLE growthmind_seo_briefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "growthmind_seo_briefs_workspace_isolation"
    ON growthmind_seo_briefs
    USING (workspace_id::text = (current_setting('app.workspace_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 2. growthmind_email_campaigns ─────────────────────────────────────────────
-- Email campaigns built and managed by the GrowthMind Email Campaign Engine.
-- status lifecycle: draft → scheduled | sent | failed

CREATE TABLE IF NOT EXISTS growthmind_email_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  preview_text    TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  body_text       TEXT NOT NULL DEFAULT '',
  cta_label       TEXT,
  cta_url         TEXT,
  from_name       TEXT,
  from_email      TEXT,
  audience        JSONB NOT NULL DEFAULT '{"type":"all"}',
  recipient_count INTEGER,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  send_result     JSONB,
  generated_by_ai BOOLEAN NOT NULL DEFAULT false,
  ai_model        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_email_campaigns_workspace
  ON growthmind_email_campaigns (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_email_campaigns_status
  ON growthmind_email_campaigns (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_gm_email_campaigns_created
  ON growthmind_email_campaigns (workspace_id, created_at DESC);

ALTER TABLE growthmind_email_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "growthmind_email_campaigns_workspace_isolation"
    ON growthmind_email_campaigns
    USING (workspace_id::text = (current_setting('app.workspace_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. growthmind_domain_warmups ──────────────────────────────────────────────
-- Domain warm-up tracking plans. One row per sending domain.

CREATE TABLE IF NOT EXISTS growthmind_domain_warmups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL,
  domain          TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  phase           INTEGER NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 4),
  current_day     INTEGER NOT NULL DEFAULT 1,
  total_days      INTEGER NOT NULL DEFAULT 30,
  daily_plan      JSONB NOT NULL DEFAULT '[]',
  completed_days  INTEGER[] NOT NULL DEFAULT '{}',
  reputation_score INTEGER,
  bounce_rate     NUMERIC(5,2),
  spam_rate       NUMERIC(5,2),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','completed','abandoned')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_domain_warmups_workspace
  ON growthmind_domain_warmups (workspace_id);

CREATE INDEX IF NOT EXISTS idx_gm_domain_warmups_domain
  ON growthmind_domain_warmups (workspace_id, domain);

ALTER TABLE growthmind_domain_warmups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "growthmind_domain_warmups_workspace_isolation"
    ON growthmind_domain_warmups
    USING (workspace_id::text = (current_setting('app.workspace_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- End of migration
-- ─────────────────────────────────────────────────────────────────────────────
