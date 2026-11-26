-- Backfill: create personal workspaces for users who signed up before the
-- unified_workspaces auto-provision trigger was in place (20260531120000).
-- Safe to run multiple times — only affects users with no workspace membership.

DO $$
DECLARE
  _user  RECORD;
  _workspace_id UUID;
  _base_slug TEXT;
  _slug  TEXT;
  _counter INT;
BEGIN
  FOR _user IN
    SELECT
      au.id,
      au.email,
      au.raw_user_meta_data
    FROM auth.users au
    JOIN public.profiles p ON p.user_id = au.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = au.id
    )
  LOOP
    -- Derive slug from display name or email local part
    _base_slug := lower(regexp_replace(
      coalesce(
        _user.raw_user_meta_data ->> 'full_name',
        split_part(_user.email, '@', 1)
      ),
      '[^a-z0-9]+', '-', 'g'
    ));
    IF length(_base_slug) < 3 THEN
      _base_slug := 'user-' || substr(_user.id::text, 1, 8);
    END IF;

    -- Append user-id suffix for uniqueness (same algorithm as the trigger)
    _slug := left(_base_slug, 55) || '-' || substr(_user.id::text, 1, 6);

    -- Collision guard (very unlikely given the suffix)
    _counter := 0;
    WHILE EXISTS (SELECT 1 FROM public.workspaces WHERE slug = _slug) LOOP
      _counter := _counter + 1;
      _slug := left(_base_slug, 50) || '-' || substr(_user.id::text, 1, 6) || '-' || _counter::text;
    END LOOP;

    -- Create workspace
    INSERT INTO public.workspaces (name, slug, owner_id)
    VALUES (
      coalesce(
        _user.raw_user_meta_data ->> 'full_name',
        split_part(_user.email, '@', 1)
      ) || '''s Workspace',
      _slug,
      _user.id
    )
    RETURNING id INTO _workspace_id;

    -- Add user as workspace owner
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (_workspace_id, _user.id, 'owner');

    -- Create default workspace settings
    INSERT INTO public.workspace_settings (workspace_id, business_name)
    VALUES (
      _workspace_id,
      coalesce(
        _user.raw_user_meta_data ->> 'full_name',
        split_part(_user.email, '@', 1)
      )
    )
    ON CONFLICT (workspace_id) DO NOTHING;

    -- Point profile at the new workspace
    UPDATE public.profiles
    SET default_workspace_id = _workspace_id
    WHERE user_id = _user.id
      AND default_workspace_id IS NULL;

  END LOOP;
END;
$$;
