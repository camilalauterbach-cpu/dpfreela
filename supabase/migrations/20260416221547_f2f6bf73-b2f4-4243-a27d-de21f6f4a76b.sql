DROP POLICY IF EXISTS soft_deleted_select_companies ON public.companies;
CREATE POLICY soft_deleted_select_companies
ON public.companies
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_events ON public.events;
CREATE POLICY soft_deleted_select_events
ON public.events
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_workers ON public.workers;
CREATE POLICY soft_deleted_select_workers
ON public.workers
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_link_groups ON public.link_groups;
CREATE POLICY soft_deleted_select_link_groups
ON public.link_groups
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_link_group_workers ON public.link_group_workers;
CREATE POLICY soft_deleted_select_link_group_workers
ON public.link_group_workers
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_employment_links ON public.employment_links;
CREATE POLICY soft_deleted_select_employment_links
ON public.employment_links
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_employment_link_documents ON public.employment_link_documents;
CREATE POLICY soft_deleted_select_employment_link_documents
ON public.employment_link_documents
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_worker_documents ON public.worker_documents;
CREATE POLICY soft_deleted_select_worker_documents
ON public.worker_documents
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_worker_payment_methods ON public.worker_payment_methods;
CREATE POLICY soft_deleted_select_worker_payment_methods
ON public.worker_payment_methods
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_worker_dependents ON public.worker_dependents;
CREATE POLICY soft_deleted_select_worker_dependents
ON public.worker_dependents
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_payroll_batches ON public.payroll_batches;
CREATE POLICY soft_deleted_select_payroll_batches
ON public.payroll_batches
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_payroll_batch_items ON public.payroll_batch_items;
CREATE POLICY soft_deleted_select_payroll_batch_items
ON public.payroll_batch_items
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role, 'operator'::public.app_role])
  AND deleted_at IS NOT NULL
);

DROP POLICY IF EXISTS soft_deleted_select_payment_receipts ON public.payment_receipts;
CREATE POLICY soft_deleted_select_payment_receipts
ON public.payment_receipts
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role])
  AND deleted_at IS NOT NULL
);