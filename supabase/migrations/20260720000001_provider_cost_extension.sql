-- Provider Framework: Cost Engine Extension
-- Adds per-unit cost tracking for Email, Image, Video, WhatsApp, Analytics, Advertising, CRM, Calendar.
-- Apply in Supabase SQL Editor.

-- ── 1. Extend provider_usage with per-unit counters ───────────────────────────
ALTER TABLE provider_usage
  ADD COLUMN IF NOT EXISTS units_consumed   NUMERIC(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_type        TEXT,           -- 'email', 'image', 'video_seconds', 'whatsapp', 'api_call', 'sync'
  ADD COLUMN IF NOT EXISTS cost_per_unit_usd NUMERIC(18,8) DEFAULT 0;

-- ── 2. provider_cost_rates — workspace-level per-unit cost overrides ──────────
CREATE TABLE IF NOT EXISTS provider_cost_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_category TEXT NOT NULL,
  provider_name   TEXT NOT NULL,
  unit_type       TEXT NOT NULL,
  cost_per_unit_usd NUMERIC(18,8) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider_category, provider_name, unit_type)
);

-- ── 3. Seed default platform cost rates ──────────────────────────────────────
-- These are approximate public list prices and can be overridden per workspace.
INSERT INTO provider_cost_rates (workspace_id, provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
SELECT
  w.id,
  r.provider_category,
  r.provider_name,
  r.unit_type,
  r.cost_per_unit_usd,
  r.notes
FROM workspaces w
CROSS JOIN (VALUES
  -- Email ($0.0008 per email = $0.80 per 1K; $0.0006 per email = $0.60 per 1K)
  ('email',       'resend',             'email',          0.0008,      'Resend: $0.80 per 1K emails'),
  ('email',       'sendgrid',           'email',          0.0006,      'SendGrid Essentials: $0.60 per 1K emails'),
  -- Image
  ('image',       'gpt_image',          'image',          0.04,        'DALL-E 3 standard 1024x1024'),
  ('image',       'imagen',             'image',          0.02,        'Imagen 3 est. $0.02/image'),
  -- Video (per second of output)
  ('video',       'runway',             'video_seconds',  0.05,        'Runway Gen3: ~$0.05/sec'),
  ('video',       'google_veo',         'video_seconds',  0.06,        'Google Veo est. $0.06/sec'),
  -- WhatsApp (per outbound message)
  ('whatsapp',    'wati',               'whatsapp',       0.005,       'WATI: ~$0.005/msg (varies by country)'),
  ('whatsapp',    'meta',               'whatsapp',       0.0035,      'Meta: ~$0.0035/msg utility'),
  -- Analytics (per API call)
  ('analytics',   'google_analytics',   'api_call',       0.0,         'GA4 Data API: free tier'),
  -- Advertising (per sync pull)
  ('advertising', 'google_ads',         'sync',           0.0,         'Google Ads API: free'),
  ('advertising', 'meta_ads',           'sync',           0.0,         'Meta Marketing API: free'),
  -- CRM (per API request batch)
  ('crm',         'hubspot',            'api_call',       0.0,         'HubSpot: free tier'),
  ('crm',         'gohighlevel',        'api_call',       0.0,         'GHL: included in subscription'),
  -- Calendar
  ('calendar',    'calcom',             'api_call',       0.0,         'Cal.com: free tier'),
  ('calendar',    'google',             'api_call',       0.0,         'Google Calendar API: free')
) AS r(provider_category, provider_name, unit_type, cost_per_unit_usd, notes)
ON CONFLICT (workspace_id, provider_category, provider_name, unit_type) DO NOTHING;

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE provider_cost_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can read cost rates"
  ON provider_cost_rates FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace admins can manage cost rates"
  ON provider_cost_rates FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- ── 5. provider_credential_audit — logs when credentials are saved ────────────
CREATE TABLE IF NOT EXISTS provider_credential_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  provider_category TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('save','delete','test_ok','test_fail')),
  latency_ms    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE provider_credential_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace admins can read audit log"
  ON provider_credential_audit FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
