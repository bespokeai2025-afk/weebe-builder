-- GrowthMind Phase 2 — SEO Sites & Competitors
-- NOTE: growthmind_playbooks was already created in 20260625000000_growthmind_phase2.sql
--       with CHECK (status IN ('active','archived')). Do not re-create it here.

-- SEO Sites: one site per workspace with JSONB keywords and content ideas
CREATE TABLE IF NOT EXISTS growthmind_seo_sites (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID NOT NULL,
  url           TEXT NOT NULL,
  keywords      JSONB NOT NULL DEFAULT '[]',
  content_ideas JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growthmind_seo_sites_workspace
  ON growthmind_seo_sites (workspace_id);

ALTER TABLE growthmind_seo_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_growthmind_seo_sites"
  ON growthmind_seo_sites FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Competitors: per-workspace competitor intelligence store
CREATE TABLE IF NOT EXISTS growthmind_competitors (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  UUID NOT NULL,
  name          TEXT NOT NULL,
  website       TEXT NOT NULL DEFAULT '',
  services      TEXT NOT NULL DEFAULT '',
  offers        TEXT NOT NULL DEFAULT '',
  positioning   TEXT NOT NULL DEFAULT '',
  observations  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growthmind_competitors_workspace
  ON growthmind_competitors (workspace_id);

ALTER TABLE growthmind_competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_growthmind_competitors"
  ON growthmind_competitors FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
