
-- 1. change_logs: enforce changed_by = auth.uid() on insert
DROP POLICY IF EXISTS insert_change_logs ON public.change_logs;
CREATE POLICY insert_change_logs ON public.change_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role])
    AND changed_by = auth.uid()
  );

-- 2. system_settings: require any app role for public-settings read
DROP POLICY IF EXISTS authenticated_select_public_settings ON public.system_settings;
CREATE POLICY authenticated_select_public_settings ON public.system_settings
  FOR SELECT TO authenticated
  USING (
    setting_key = ANY (ARRAY['company_info'::text, 'links_admission_config'::text])
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role, 'viewer'::app_role])
  );

-- 3. Remove 'viewer' from SELECT on sensitive PII tables
DROP POLICY IF EXISTS select_workers ON public.workers;
CREATE POLICY select_workers ON public.workers
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role])
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS select_worker_dependents ON public.worker_dependents;
CREATE POLICY select_worker_dependents ON public.worker_dependents
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role])
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS select_worker_payment_methods ON public.worker_payment_methods;
CREATE POLICY select_worker_payment_methods ON public.worker_payment_methods
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role])
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS select_employment_links ON public.employment_links;
CREATE POLICY select_employment_links ON public.employment_links
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role])
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS select_payroll_batch_items ON public.payroll_batch_items;
CREATE POLICY select_payroll_batch_items ON public.payroll_batch_items
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'operator'::app_role])
    AND deleted_at IS NULL
  );

-- 4. Lock down SECURITY DEFINER function execution
-- Trigger-only functions: nothing outside the DB should call these
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Helper/RPC functions: revoke from anon/public (still callable by authenticated users
-- where required for RLS evaluation and admin-only RPC self-gated by has_any_role).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_audit_user_emails(uuid[]) FROM PUBLIC, anon;
