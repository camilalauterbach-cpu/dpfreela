
-- Grant viewer role read access to remaining core tables so they see, not blank screens.

DROP POLICY IF EXISTS select_workers ON public.workers;
CREATE POLICY select_workers ON public.workers FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

DROP POLICY IF EXISTS select_worker_dependents ON public.worker_dependents;
CREATE POLICY select_worker_dependents ON public.worker_dependents FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

DROP POLICY IF EXISTS select_worker_documents ON public.worker_documents;
CREATE POLICY select_worker_documents ON public.worker_documents FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

DROP POLICY IF EXISTS select_worker_payment_methods ON public.worker_payment_methods;
CREATE POLICY select_worker_payment_methods ON public.worker_payment_methods FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

DROP POLICY IF EXISTS select_employment_links ON public.employment_links;
CREATE POLICY select_employment_links ON public.employment_links FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

DROP POLICY IF EXISTS select_payment_receipts ON public.payment_receipts;
CREATE POLICY select_payment_receipts ON public.payment_receipts FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);

DROP POLICY IF EXISTS select_payroll_batch_items ON public.payroll_batch_items;
CREATE POLICY select_payroll_batch_items ON public.payroll_batch_items FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]) AND deleted_at IS NULL);
