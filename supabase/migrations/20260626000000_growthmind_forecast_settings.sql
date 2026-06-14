-- GrowthMind Phase 2: forecast deal-value settings stored in workspace_settings
-- Apply in Supabase SQL Editor

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS growthmind_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
