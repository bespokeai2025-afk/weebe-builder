
CREATE TABLE public.workspace_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMP WITH TIME ZONE,
  decided_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.workspace_requests TO authenticated;
GRANT ALL ON public.workspace_requests TO service_role;

ALTER TABLE public.workspace_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own workspace requests"
ON public.workspace_requests FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own workspace requests"
ON public.workspace_requests FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all workspace requests"
ON public.workspace_requests FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update workspace requests"
ON public.workspace_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER workspace_requests_touch_updated_at
BEFORE UPDATE ON public.workspace_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_workspace_requests_user ON public.workspace_requests(user_id);
CREATE INDEX idx_workspace_requests_status ON public.workspace_requests(status);
