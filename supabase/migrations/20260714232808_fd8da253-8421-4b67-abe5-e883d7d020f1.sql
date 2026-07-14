-- Remove auto-grant of viewer role for new signups.
-- New accounts must have a role explicitly assigned by an admin/manager.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), public.profiles.avatar_url);

  -- No default role assignment. Admin/manager must grant access explicitly.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_current_user_access()
 RETURNS TABLE(roles app_role[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid := auth.uid();
  current_email text;
  disabled_at timestamp with time zone;
  did_create_profile boolean := false;
  final_roles app_role[];
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT email::text INTO current_email
  FROM auth.users
  WHERE id = current_user_id;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = current_user_id) THEN
    INSERT INTO public.profiles (user_id, full_name, avatar_url)
    VALUES (current_user_id, '', '')
    ON CONFLICT (user_id) DO NOTHING;
    did_create_profile := true;
  END IF;

  SELECT access_disabled_at
  INTO disabled_at
  FROM public.profiles
  WHERE user_id = current_user_id;

  IF disabled_at IS NOT NULL THEN
    IF did_create_profile THEN
      INSERT INTO public.access_repair_logs (user_id, email, reason, profile_created, role_assigned, roles_after)
      VALUES (current_user_id, current_email, 'profile_created_disabled_user', true, false, ARRAY[]::app_role[]);
    END IF;
    RETURN QUERY SELECT ARRAY[]::public.app_role[];
    RETURN;
  END IF;

  -- Do NOT auto-assign viewer role. Roles must be granted by admin/manager.
  SELECT COALESCE(array_agg(ur.role ORDER BY ur.role), ARRAY[]::public.app_role[])
  INTO final_roles
  FROM public.user_roles ur
  WHERE ur.user_id = current_user_id;

  IF did_create_profile THEN
    INSERT INTO public.access_repair_logs (user_id, email, reason, profile_created, role_assigned, roles_after)
    VALUES (current_user_id, current_email, 'profile_created', true, false, final_roles);
  END IF;

  RETURN QUERY SELECT final_roles;
END;
$function$;