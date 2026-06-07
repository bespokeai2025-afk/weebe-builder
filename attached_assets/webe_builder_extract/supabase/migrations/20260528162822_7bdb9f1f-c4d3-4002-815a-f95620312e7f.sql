CREATE TABLE public.agent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('global','personal')),
  owner_user_id UUID,
  name TEXT NOT NULL DEFAULT 'Untitled template',
  description TEXT NOT NULL DEFAULT '',
  flow_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_templates_owner_chk CHECK (
    (scope = 'global' AND owner_user_id IS NULL)
    OR (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_templates TO authenticated;
GRANT ALL ON public.agent_templates TO service_role;

ALTER TABLE public.agent_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View global templates"
ON public.agent_templates FOR SELECT TO authenticated
USING (scope = 'global');

CREATE POLICY "View own personal templates"
ON public.agent_templates FOR SELECT TO authenticated
USING (scope = 'personal' AND owner_user_id = auth.uid());

CREATE POLICY "Insert own personal templates"
ON public.agent_templates FOR INSERT TO authenticated
WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid());

CREATE POLICY "Update own personal templates"
ON public.agent_templates FOR UPDATE TO authenticated
USING (scope = 'personal' AND owner_user_id = auth.uid());

CREATE POLICY "Delete own personal templates"
ON public.agent_templates FOR DELETE TO authenticated
USING (scope = 'personal' AND owner_user_id = auth.uid());

CREATE POLICY "Admins insert global templates"
ON public.agent_templates FOR INSERT TO authenticated
WITH CHECK (scope = 'global' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update global templates"
ON public.agent_templates FOR UPDATE TO authenticated
USING (scope = 'global' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete global templates"
ON public.agent_templates FOR DELETE TO authenticated
USING (scope = 'global' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER agent_templates_touch
BEFORE UPDATE ON public.agent_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX agent_templates_scope_idx ON public.agent_templates (scope);
CREATE INDEX agent_templates_owner_idx ON public.agent_templates (owner_user_id);