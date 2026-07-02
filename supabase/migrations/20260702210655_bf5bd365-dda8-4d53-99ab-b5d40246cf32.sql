ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS access_disabled_at timestamp with time zone;

DROP POLICY IF EXISTS "Users can claim viewer role" ON public.user_roles;
CREATE POLICY "Users can claim viewer role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'viewer'::public.app_role
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.access_disabled_at IS NULL
  )
);

CREATE OR REPLACE FUNCTION public.ensure_current_user_access()
RETURNS TABLE(roles public.app_role[])
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  disabled_at timestamp with time zone;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (current_user_id, '', '')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT access_disabled_at
  INTO disabled_at
  FROM public.profiles
  WHERE user_id = current_user_id;

  IF disabled_at IS NOT NULL THEN
    RETURN QUERY SELECT ARRAY[]::public.app_role[];
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  SELECT current_user_id, 'viewer'::public.app_role
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = current_user_id
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN QUERY
  SELECT COALESCE(array_agg(ur.role ORDER BY ur.role), ARRAY[]::public.app_role[])
  FROM public.user_roles ur
  WHERE ur.user_id = current_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_current_user_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_current_user_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_access() TO service_role;