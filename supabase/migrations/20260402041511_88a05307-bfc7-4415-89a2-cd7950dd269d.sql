
-- 1. Fix system_settings: replace overly permissive SELECT policy
DROP POLICY IF EXISTS "all_authenticated_select_system_settings" ON public.system_settings;

-- Allow all authenticated users to read only known public/operational keys
CREATE POLICY "authenticated_select_public_settings"
ON public.system_settings
FOR SELECT
TO authenticated
USING (setting_key IN ('company_info', 'links_admission_config'));

-- Allow admin/manager to read ALL settings (including future sensitive ones)
CREATE POLICY "admin_manager_select_all_settings"
ON public.system_settings
FOR SELECT
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role]));

-- 2. Fix user_roles: allow users to read their OWN roles
CREATE POLICY "users_select_own_roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
