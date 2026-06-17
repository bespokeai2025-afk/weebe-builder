-- Workspace AI Generation Cost Limits
-- Adds a JSONB column to workspace_settings to store per-workspace
-- hard caps on AI generation spend (video, image, LLM).
-- When a cap is reached the generation is blocked with a clear error.

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS generation_limits JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.workspace_settings.generation_limits IS
  'Per-workspace monthly AI generation cost caps. Shape:
   {
     "video_monthly_usd": 50,     -- hard cap for Veo/Runway (default: no cap)
     "image_monthly_usd": 20,     -- hard cap for DALL-E/Imagen
     "llm_monthly_usd": 100,      -- hard cap for all LLM calls
     "enabled": true              -- master switch (default: true)
   }';

CREATE INDEX IF NOT EXISTS idx_workspace_settings_generation_limits
  ON public.workspace_settings USING gin (generation_limits);
