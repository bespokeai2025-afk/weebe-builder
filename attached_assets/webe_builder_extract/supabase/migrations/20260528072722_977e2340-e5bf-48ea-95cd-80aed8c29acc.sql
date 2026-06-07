CREATE TABLE public.agent_retell_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  production_api_key text NOT NULL,
  production_api_key_masked text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_id)
);

GRANT ALL ON public.agent_retell_secrets TO service_role;

ALTER TABLE public.agent_retell_secrets ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER agent_retell_secrets_touch
BEFORE UPDATE ON public.agent_retell_secrets
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();