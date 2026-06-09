-- Migration: add deployment_mode column to agents table.
-- This is purely additive — no existing columns are modified.
--
-- deployment_mode is the new authoritative runtime selector:
--   RETELL        — OmniVoice / Retell AI (default for all existing agents)
--   OPENAI_NATIVE — HyperStream / OpenAI Realtime
--   CLAUDE_NATIVE — future Anthropic Claude voice runtime
--   GEMINI_NATIVE — future Google Gemini voice runtime
--
-- All existing agents receive RETELL so their behaviour is unchanged.
-- Agents whose legacy voice_provider = 'OPENAI_REALTIME' are assigned
-- OPENAI_NATIVE so the new adapter resolves them correctly without
-- requiring any app-side migration logic.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS deployment_mode TEXT
    NOT NULL
    DEFAULT 'RETELL'
    CHECK (deployment_mode IN ('RETELL', 'OPENAI_NATIVE', 'CLAUDE_NATIVE', 'GEMINI_NATIVE'));

-- Back-fill: legacy HyperStream agents (voice_provider = OPENAI_REALTIME)
-- → OPENAI_NATIVE.  All other agents keep the column default of RETELL.
UPDATE agents
   SET deployment_mode = 'OPENAI_NATIVE'
 WHERE voice_provider = 'OPENAI_REALTIME'
   AND deployment_mode = 'RETELL';

-- Index for fast runtime-specific queries (analytics, billing, etc.)
CREATE INDEX IF NOT EXISTS idx_agents_deployment_mode ON agents (deployment_mode);

COMMENT ON COLUMN agents.deployment_mode IS
  'Voice runtime selector. RETELL = OmniVoice (default). '
  'OPENAI_NATIVE/CLAUDE_NATIVE/GEMINI_NATIVE = native runtime path. '
  'Set by the Builder when the user chooses an engine; never auto-switched.';
