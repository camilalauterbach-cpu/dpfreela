
-- 1) Audit table for access-repair events
CREATE TABLE public.access_repair_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  email text,
  reason text NOT NULL,
  profile_created boolean NOT NULL DEFAULT false,
  role_assigned boolean NOT NULL DEFAULT false,
  roles_after app_role[] NOT NULL DEFAULT ARRAY[]::app_role[],
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_repair_logs_user_id ON public.access_repair_logs(user_id);
CREATE INDEX idx_access_repair_logs_created_at ON public.access_repair_logs(created_at DESC);

GRANT SELECT ON public.access_repair_logs TO authenticated;
GRANT ALL ON public.access_repair_logs TO service_role;

ALTER TABLE public.access_repair_logs ENABLE ROW LEVEL SECURITY;

-- Only admins/managers can read the log
CREATE POLICY "admins_managers_read_access_repair_logs"
ON public.access_repair_logs
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role]));

-- No client INSERT policy: writes come only from SECURITY DEFINER function below.

-- 2) Update ensure_current_user_access to log repairs
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
  did_assign_role boolean := false;
  final_roles app_role[];
  repair_reason text;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT email::text INTO current_email
  FROM auth.users
  WHERE id = current_user_id;

  -- Create profile if missing
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

  -- Assign default viewer role if user has none
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = current_user_id) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (current_user_id, 'viewer'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    did_assign_role := true;
  END IF;

  SELECT COALESCE(array_agg(ur.role ORDER BY ur.role), ARRAY[]::public.app_role[])
  INTO final_roles
  FROM public.user_roles ur
  WHERE ur.user_id = current_user_id;

  -- Log the repair when something actually changed
  IF did_create_profile OR did_assign_role THEN
    repair_reason := CASE
      WHEN did_create_profile AND did_assign_role THEN 'profile_and_role_created'
      WHEN did_create_profile THEN 'profile_created'
      ELSE 'role_assigned'
    END;

    INSERT INTO public.access_repair_logs (user_id, email, reason, profile_created, role_assigned, roles_after)
    VALUES (current_user_id, current_email, repair_reason, did_create_profile, did_assign_role, final_roles);
  END IF;

  RETURN QUERY SELECT final_roles;
END;
$function$;
