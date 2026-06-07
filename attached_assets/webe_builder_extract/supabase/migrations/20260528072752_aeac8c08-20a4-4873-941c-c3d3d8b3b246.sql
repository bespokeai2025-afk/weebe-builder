CREATE POLICY "No direct user reads of agent Retell secrets"
ON public.agent_retell_secrets
FOR SELECT
TO authenticated
USING (false);

CREATE POLICY "No direct user creates of agent Retell secrets"
ON public.agent_retell_secrets
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "No direct user updates of agent Retell secrets"
ON public.agent_retell_secrets
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct user deletes of agent Retell secrets"
ON public.agent_retell_secrets
FOR DELETE
TO authenticated
USING (false);