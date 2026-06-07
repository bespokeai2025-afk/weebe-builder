CREATE TABLE public.dashboard_sync_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  endpoint_url text NOT NULL DEFAULT 'https://spark-orchestrate.lovable.app/api/public/agents/register',
  api_token text,
  api_token_last4 text,
  sync_enabled boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_sync_settings TO authenticated;
GRANT ALL ON public.dashboard_sync_settings TO service_role;

ALTER TABLE public.dashboard_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dss select own" ON public.dashboard_sync_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "dss insert own" ON public.dashboard_sync_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dss update own" ON public.dashboard_sync_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "dss delete own" ON public.dashboard_sync_settings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER dss_touch_updated_at
  BEFORE UPDATE ON public.dashboard_sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();