-- WhatsApp Management Centre: contacts, templates, campaigns

CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT,
  phone         TEXT NOT NULL,
  tags          TEXT[]   DEFAULT '{}',
  source        TEXT,
  lead_status   TEXT,
  notes         TEXT,
  archived      BOOLEAN  DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, phone)
);
CREATE INDEX IF NOT EXISTS wa_contacts_ws_idx ON public.whatsapp_contacts(workspace_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  body          TEXT NOT NULL,
  variables     TEXT[]  DEFAULT '{}',
  category      TEXT    DEFAULT 'MARKETING',
  status        TEXT    DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_templates_ws_idx ON public.whatsapp_templates(workspace_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'broadcast',
  template_id     UUID REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  audience_filter JSONB   DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  status          TEXT    DEFAULT 'draft',
  stats           JSONB   DEFAULT '{"sent":0,"delivered":0,"read":0,"replied":0}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_campaigns_ws_idx ON public.whatsapp_campaigns(workspace_id);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_contacts_sel" ON public.whatsapp_contacts FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_contacts_ins" ON public.whatsapp_contacts FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_contacts_upd" ON public.whatsapp_contacts FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_contacts_del" ON public.whatsapp_contacts FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "wa_tmpl_sel" ON public.whatsapp_templates FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_tmpl_ins" ON public.whatsapp_templates FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_tmpl_upd" ON public.whatsapp_templates FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_tmpl_del" ON public.whatsapp_templates FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "wa_camp_sel" ON public.whatsapp_campaigns FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_camp_ins" ON public.whatsapp_campaigns FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_camp_upd" ON public.whatsapp_campaigns FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "wa_camp_del" ON public.whatsapp_campaigns FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_contacts  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_campaigns TO authenticated;
GRANT ALL ON public.whatsapp_contacts  TO service_role;
GRANT ALL ON public.whatsapp_templates TO service_role;
GRANT ALL ON public.whatsapp_campaigns TO service_role;
