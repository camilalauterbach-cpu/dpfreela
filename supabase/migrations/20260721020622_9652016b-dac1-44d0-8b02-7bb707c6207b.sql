
-- 1) Views SST em modo SECURITY INVOKER (linter 0010)
ALTER VIEW public.worker_sst_qualifications_current SET (security_invoker = true);
ALTER VIEW public.worker_sst_qualifications_history SET (security_invoker = true);

-- 2) document_compliance_history — remove leitura aberta e restringe por papel
DROP POLICY IF EXISTS "Authenticated can read compliance history" ON public.document_compliance_history;
CREATE POLICY "Operational roles can read compliance history"
  ON public.document_compliance_history
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'viewer'::public.app_role)
  );

-- 3) employment_link_document_overrides — remove SELECT aberto (USING true)
DROP POLICY IF EXISTS "elo_select_authenticated" ON public.employment_link_document_overrides;
CREATE POLICY "elo_operational_roles_can_read"
  ON public.employment_link_document_overrides
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'operator'::public.app_role)
    OR public.has_role(auth.uid(), 'viewer'::public.app_role)
  );
