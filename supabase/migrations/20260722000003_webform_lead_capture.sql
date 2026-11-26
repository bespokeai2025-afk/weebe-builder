-- Webform Lead Capture System
-- Creates webform_sources, webform_submissions tables
-- Safely adds missing tracking columns to leads

-- ── Webform Sources ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webform_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  form_token          TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  allowed_domains     TEXT[] DEFAULT '{}',
  default_source_type TEXT NOT NULL DEFAULT 'website_form',
  default_source_detail TEXT DEFAULT NULL,
  field_mapping_json  JSONB DEFAULT '{}',
  notify_email        TEXT DEFAULT NULL,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webform_sources_workspace ON webform_sources(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webform_sources_token ON webform_sources(form_token);

-- ── Webform Submissions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webform_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  webform_source_id   UUID NOT NULL REFERENCES webform_sources(id) ON DELETE CASCADE,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  source_type         TEXT NOT NULL DEFAULT 'website_form',
  source_detail       TEXT DEFAULT NULL,
  raw_payload         JSONB NOT NULL DEFAULT '{}',
  mapped_payload      JSONB NOT NULL DEFAULT '{}',
  utm_source          TEXT DEFAULT NULL,
  utm_medium          TEXT DEFAULT NULL,
  utm_campaign        TEXT DEFAULT NULL,
  referrer            TEXT DEFAULT NULL,
  ip_address          TEXT DEFAULT NULL,
  user_agent          TEXT DEFAULT NULL,
  status              TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'duplicate', 'failed', 'spam')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webform_submissions_workspace ON webform_submissions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webform_submissions_source ON webform_submissions(webform_source_id);
CREATE INDEX IF NOT EXISTS idx_webform_submissions_lead ON webform_submissions(lead_id);
CREATE INDEX IF NOT EXISTS idx_webform_submissions_created ON webform_submissions(created_at DESC);

-- ── Extend leads table (safe, idempotent) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='source_type') THEN
    ALTER TABLE leads ADD COLUMN source_type TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='source_detail') THEN
    ALTER TABLE leads ADD COLUMN source_detail TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='source_page') THEN
    ALTER TABLE leads ADD COLUMN source_page TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='utm_source') THEN
    ALTER TABLE leads ADD COLUMN utm_source TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='utm_medium') THEN
    ALTER TABLE leads ADD COLUMN utm_medium TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='utm_campaign') THEN
    ALTER TABLE leads ADD COLUMN utm_campaign TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='referrer') THEN
    ALTER TABLE leads ADD COLUMN referrer TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='external_source_id') THEN
    ALTER TABLE leads ADD COLUMN external_source_id TEXT DEFAULT NULL;
  END IF;
END $$;

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE webform_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE webform_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_webform_sources" ON webform_sources;
CREATE POLICY "workspace_webform_sources" ON webform_sources
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "workspace_webform_submissions" ON webform_submissions;
CREATE POLICY "workspace_webform_submissions" ON webform_submissions
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ── Rate limit table for public endpoint ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS webform_rate_limits (
  key         TEXT PRIMARY KEY,
  count       INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
