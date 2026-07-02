CREATE OR REPLACE FUNCTION public.ensure_current_user_access()
RETURNS TABLE(roles public.app_role[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  metadata jsonb;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT raw_user_meta_data
  INTO metadata
  FROM auth.users
  WHERE id = current_user_id;

  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    current_user_id,
    COALESCE(metadata->>'full_name', ''),
    COALESCE(metadata->>'avatar_url', '')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), public.profiles.avatar_url),
    updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  SELECT current_user_id, 'viewer'::public.app_role
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = current_user_id
  );

  RETURN QUERY
  SELECT array_agg(ur.role ORDER BY ur.role)::public.app_role[]
  FROM public.user_roles ur
  WHERE ur.user_id = current_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_current_user_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_access() TO service_role;

INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'viewer'::public.app_role
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles ur
  WHERE ur.user_id = p.user_id
);