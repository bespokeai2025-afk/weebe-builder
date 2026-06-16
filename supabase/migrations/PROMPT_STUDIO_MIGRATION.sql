-- Prompt Intelligence System V2
-- Apply in Supabase SQL Editor (safe to re-run — all IF NOT EXISTS / OR REPLACE)

-- ── 1. Prompt Templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_prompt_templates (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  description          TEXT,
  type                 TEXT        NOT NULL DEFAULT 'content',
  category             TEXT        NOT NULL DEFAULT 'custom',
  system_prompt        TEXT        NOT NULL DEFAULT '',
  user_prompt_template TEXT        NOT NULL DEFAULT '',
  variables            JSONB       NOT NULL DEFAULT '[]',
  chain_steps          JSONB       NOT NULL DEFAULT '[]',
  tags                 TEXT[]      NOT NULL DEFAULT '{}',
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  is_favorite          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_workspace
  ON growthmind_prompt_templates(workspace_id);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_type
  ON growthmind_prompt_templates(workspace_id, type);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_category
  ON growthmind_prompt_templates(workspace_id, category);

-- ── 2. Prompt Versions (version history per template) ────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_prompt_versions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id          UUID        NOT NULL REFERENCES growthmind_prompt_templates(id) ON DELETE CASCADE,
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version              INTEGER     NOT NULL DEFAULT 1,
  system_prompt        TEXT        NOT NULL DEFAULT '',
  user_prompt_template TEXT        NOT NULL DEFAULT '',
  variables            JSONB       NOT NULL DEFAULT '[]',
  change_note          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_template
  ON growthmind_prompt_versions(template_id, version DESC);

-- ── 3. Prompt Tests (A/B test run definitions) ───────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_prompt_tests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id  UUID        REFERENCES growthmind_prompt_templates(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  variants     JSONB       NOT NULL DEFAULT '[]',
  status       TEXT        NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prompt_tests_workspace
  ON growthmind_prompt_tests(workspace_id);

-- ── 4. Prompt Test Outputs (per-variant outputs + scores) ────────────────────
CREATE TABLE IF NOT EXISTS growthmind_prompt_test_outputs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id         UUID        REFERENCES growthmind_prompt_tests(id) ON DELETE CASCADE,
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id     UUID        REFERENCES growthmind_prompt_templates(id) ON DELETE SET NULL,
  variant_label   TEXT        NOT NULL DEFAULT 'A',
  input_variables JSONB       NOT NULL DEFAULT '{}',
  output_text     TEXT        NOT NULL DEFAULT '',
  scores          JSONB       NOT NULL DEFAULT '{}',
  model_used      TEXT,
  provider_used   TEXT,
  cost_usd        NUMERIC(10,6),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_test_outputs_workspace
  ON growthmind_prompt_test_outputs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_test_outputs_template
  ON growthmind_prompt_test_outputs(template_id);

-- ── 5. Prompt Stats (aggregated per template) ────────────────────────────────
CREATE TABLE IF NOT EXISTS growthmind_prompt_stats (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID        NOT NULL REFERENCES growthmind_prompt_templates(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  usage_count  INTEGER     NOT NULL DEFAULT 0,
  avg_score    NUMERIC(4,2),
  success_rate NUMERIC(5,2),
  last_used_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(template_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_stats_workspace
  ON growthmind_prompt_stats(workspace_id, avg_score DESC NULLS LAST);
