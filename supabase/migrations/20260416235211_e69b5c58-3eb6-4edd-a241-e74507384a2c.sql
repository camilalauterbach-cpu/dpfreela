-- Partial indexes on deleted_at (only active rows are queried 99% of the time)
CREATE INDEX IF NOT EXISTS idx_workers_active ON public.workers (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_companies_active ON public.companies (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_active ON public.events (start_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employment_links_active ON public.employment_links (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_link_groups_active ON public.link_groups (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_link_group_workers_active ON public.link_group_workers (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employment_link_documents_active ON public.employment_link_documents (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_worker_documents_active ON public.worker_documents (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_worker_payment_methods_active ON public.worker_payment_methods (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_worker_dependents_active ON public.worker_dependents (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_batches_active ON public.payroll_batches (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_batch_items_active ON public.payroll_batch_items (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_receipts_active ON public.payment_receipts (created_at DESC) WHERE deleted_at IS NULL;

-- Foreign-key-like columns used in filters/joins
CREATE INDEX IF NOT EXISTS idx_employment_links_worker_id ON public.employment_links (worker_id);
CREATE INDEX IF NOT EXISTS idx_employment_links_event_id ON public.employment_links (event_id);
CREATE INDEX IF NOT EXISTS idx_employment_links_company_id ON public.employment_links (company_id);

CREATE INDEX IF NOT EXISTS idx_link_groups_event_id ON public.link_groups (event_id);
CREATE INDEX IF NOT EXISTS idx_link_groups_company_id ON public.link_groups (company_id);

CREATE INDEX IF NOT EXISTS idx_link_group_workers_link_group_id ON public.link_group_workers (link_group_id);
CREATE INDEX IF NOT EXISTS idx_link_group_workers_worker_id ON public.link_group_workers (worker_id);

CREATE INDEX IF NOT EXISTS idx_employment_link_documents_worker_id ON public.employment_link_documents (worker_id);
CREATE INDEX IF NOT EXISTS idx_employment_link_documents_event_id ON public.employment_link_documents (event_id);
CREATE INDEX IF NOT EXISTS idx_employment_link_documents_employment_link_id ON public.employment_link_documents (employment_link_id);
CREATE INDEX IF NOT EXISTS idx_employment_link_documents_link_group_worker_id ON public.employment_link_documents (link_group_worker_id);

CREATE INDEX IF NOT EXISTS idx_worker_documents_worker_id ON public.worker_documents (worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_payment_methods_worker_id ON public.worker_payment_methods (worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_dependents_worker_id ON public.worker_dependents (worker_id);

CREATE INDEX IF NOT EXISTS idx_events_company_id ON public.events (company_id);

CREATE INDEX IF NOT EXISTS idx_payroll_batches_event_id ON public.payroll_batches (event_id);
CREATE INDEX IF NOT EXISTS idx_payroll_batch_items_batch_id ON public.payroll_batch_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_batch_items_worker_id ON public.payroll_batch_items (worker_id);
CREATE INDEX IF NOT EXISTS idx_payroll_batch_items_employment_link_id ON public.payroll_batch_items (employment_link_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_batch_id ON public.payment_receipts (batch_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_item_id ON public.payment_receipts (item_id);

-- Useful for unique CPF lookups (workers)
CREATE INDEX IF NOT EXISTS idx_workers_cpf ON public.workers (cpf) WHERE deleted_at IS NULL;