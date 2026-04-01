
-- =============================================
-- RLS POLICIES FOR ALL TABLES
-- =============================================

-- Helper arrays for reuse in policies
-- admin_manager = ARRAY['admin','manager']::public.app_role[]
-- admin_manager_operator = ARRAY['admin','manager','operator']::public.app_role[]

-- ============ COMPANIES ============
CREATE POLICY "admin_manager_select_companies"
  ON public.companies FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "admin_manager_insert_companies"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

CREATE POLICY "admin_manager_update_companies"
  ON public.companies FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

CREATE POLICY "admin_manager_delete_companies"
  ON public.companies FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ EVENTS ============
CREATE POLICY "all_roles_select_events"
  ON public.events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "admin_manager_insert_events"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

CREATE POLICY "admin_manager_update_events"
  ON public.events FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

CREATE POLICY "admin_manager_delete_events"
  ON public.events FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ WORKERS ============
CREATE POLICY "select_workers"
  ON public.workers FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_workers"
  ON public.workers FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_workers"
  ON public.workers FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_workers"
  ON public.workers FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ WORKER_DEPENDENTS ============
CREATE POLICY "select_worker_dependents"
  ON public.worker_dependents FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_worker_dependents"
  ON public.worker_dependents FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_worker_dependents"
  ON public.worker_dependents FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_worker_dependents"
  ON public.worker_dependents FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ WORKER_PAYMENT_METHODS ============
CREATE POLICY "select_worker_payment_methods"
  ON public.worker_payment_methods FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_worker_payment_methods"
  ON public.worker_payment_methods FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_worker_payment_methods"
  ON public.worker_payment_methods FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_worker_payment_methods"
  ON public.worker_payment_methods FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ WORKER_DOCUMENTS ============
CREATE POLICY "select_worker_documents"
  ON public.worker_documents FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_worker_documents"
  ON public.worker_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_worker_documents"
  ON public.worker_documents FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_worker_documents"
  ON public.worker_documents FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ EMPLOYMENT_LINKS ============
CREATE POLICY "select_employment_links"
  ON public.employment_links FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_employment_links"
  ON public.employment_links FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_employment_links"
  ON public.employment_links FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_employment_links"
  ON public.employment_links FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ EMPLOYMENT_LINK_DOCUMENTS ============
CREATE POLICY "select_employment_link_documents"
  ON public.employment_link_documents FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_employment_link_documents"
  ON public.employment_link_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_employment_link_documents"
  ON public.employment_link_documents FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_employment_link_documents"
  ON public.employment_link_documents FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ PAYROLL_BATCHES ============
CREATE POLICY "select_payroll_batches"
  ON public.payroll_batches FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_payroll_batches"
  ON public.payroll_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_payroll_batches"
  ON public.payroll_batches FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_payroll_batches"
  ON public.payroll_batches FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ PAYROLL_BATCH_ITEMS ============
CREATE POLICY "select_payroll_batch_items"
  ON public.payroll_batch_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_payroll_batch_items"
  ON public.payroll_batch_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_payroll_batch_items"
  ON public.payroll_batch_items FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "delete_payroll_batch_items"
  ON public.payroll_batch_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ PAYMENT_RECEIPTS ============
CREATE POLICY "select_payment_receipts"
  ON public.payment_receipts FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]) AND deleted_at IS NULL);

CREATE POLICY "insert_payment_receipts"
  ON public.payment_receipts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "update_payment_receipts"
  ON public.payment_receipts FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

CREATE POLICY "delete_payment_receipts"
  ON public.payment_receipts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ CHANGE_LOGS (immutable) ============
CREATE POLICY "insert_change_logs"
  ON public.change_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

CREATE POLICY "select_change_logs"
  ON public.change_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- No UPDATE or DELETE policies = immutable

-- ============ SAVED_FILTERS ============
CREATE POLICY "users_manage_own_filters"
  ON public.saved_filters FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================
-- STORAGE BUCKETS + POLICIES
-- =============================================

-- Create buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('worker-documents', 'worker-documents', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('link-documents', 'link-documents', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-receipts', 'payment-receipts', false);

-- ============ WORKER-DOCUMENTS bucket ============
-- SELECT: admin, manager, operator (NO viewer)
CREATE POLICY "worker_docs_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'worker-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

-- INSERT: admin, manager, operator
CREATE POLICY "worker_docs_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'worker-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

-- UPDATE: admin, manager only
CREATE POLICY "worker_docs_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'worker-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- DELETE: admin, manager only
CREATE POLICY "worker_docs_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'worker-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ LINK-DOCUMENTS bucket ============
-- SELECT: all roles including viewer
CREATE POLICY "link_docs_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'link-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::public.app_role[]));

-- INSERT: admin, manager, operator
CREATE POLICY "link_docs_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'link-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

-- UPDATE: admin, manager only
CREATE POLICY "link_docs_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'link-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- DELETE: admin, manager only
CREATE POLICY "link_docs_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'link-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- ============ PAYMENT-RECEIPTS bucket ============
-- SELECT: admin, manager, operator (NO viewer)
CREATE POLICY "receipts_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

-- INSERT: admin, manager, operator
CREATE POLICY "receipts_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-receipts' AND public.has_any_role(auth.uid(), ARRAY['admin','manager','operator']::public.app_role[]));

-- UPDATE: admin, manager only
CREATE POLICY "receipts_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.has_any_role(auth.uid(), ARRAY['admin','manager']::public.app_role[]));

-- DELETE: admin ONLY
CREATE POLICY "receipts_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.has_role(auth.uid(), 'admin'));
