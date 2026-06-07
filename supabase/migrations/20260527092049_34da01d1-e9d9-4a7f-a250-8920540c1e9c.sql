
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, approved, approval_decided_at)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN lower(NEW.email) = 'nathanbrett1994@icloud.com' THEN true ELSE false END,
    CASE WHEN lower(NEW.email) = 'nathanbrett1994@icloud.com' THEN now() ELSE NULL END
  );

  IF lower(NEW.email) = 'nathanbrett1994@icloud.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- If the account already exists from a prior test, promote it now
UPDATE public.profiles
SET approved = true, denied = false, approval_decided_at = now()
WHERE lower(email) = 'nathanbrett1994@icloud.com';

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin'::app_role FROM public.profiles
WHERE lower(email) = 'nathanbrett1994@icloud.com'
ON CONFLICT DO NOTHING;
