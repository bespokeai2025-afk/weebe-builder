-- Knowledge Context Selector for Video Studio
-- Apply in Supabase SQL Editor

ALTER TABLE growthmind_video_assets
  ADD COLUMN IF NOT EXISTS knowledge_context_type  text,
  ADD COLUMN IF NOT EXISTS knowledge_context_id    uuid,
  ADD COLUMN IF NOT EXISTS knowledge_context_name  text,
  ADD COLUMN IF NOT EXISTS business_name           text;

COMMENT ON COLUMN growthmind_video_assets.knowledge_context_type IS
  'One of: default | specific_kb | custom_campaign | none';

COMMENT ON COLUMN growthmind_video_assets.knowledge_context_id IS
  'UUID of the executive_knowledge_bases row used (when type = specific_kb)';

COMMENT ON COLUMN growthmind_video_assets.knowledge_context_name IS
  'Human-readable label for the selected context, shown on asset card';

COMMENT ON COLUMN growthmind_video_assets.business_name IS
  'Effective business/company name used in this generation (may differ from workspace name for custom campaigns)';
