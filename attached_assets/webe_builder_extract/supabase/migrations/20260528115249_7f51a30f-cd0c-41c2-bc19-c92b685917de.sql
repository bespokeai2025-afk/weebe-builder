-- 1) Prevent users from reading their own approval_token column.
-- Revoke column-level SELECT on approval_token from authenticated users; admins use service role / admin client.
REVOKE SELECT (approval_token) ON public.profiles FROM authenticated;
REVOKE SELECT (approval_token) ON public.profiles FROM anon;

-- 2) Lock down user_roles against any direct writes by authenticated users.
CREATE POLICY "No direct user inserts of roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No direct user updates of roles"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "No direct user deletes of roles"
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (false);