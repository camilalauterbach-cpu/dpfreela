-- Corrige classificação de expiração nas views SST.
-- Regra canônica: validity_status é a fonte primária.
--   no_expiry     => somente validity_status='no_expiry'
--   unknown       => validity_status='unknown' OU (has_expiry sem data — inconsistência)
--   expired/expiring_soon/valid => somente has_expiry + expires_at NOT NULL

DROP VIEW IF EXISTS public.worker_sst_qualifications_current;
DROP VIEW IF EXISTS public.worker_sst_qualifications_history;

CREATE VIEW public.worker_sst_qualifications_current
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (worker_id, chain_key)
  id, worker_id, nr_code, chain_key,
  training_type, issued_at, expires_at, workload_hours,
  provider_name, instructor_name, document_url, document_status,
  validity_status, source_type, revision_type,
  employment_link_document_id, link_group_worker_id, link_group_id, event_id, company_id,
  notes, created_at, updated_at,
  CASE
    WHEN validity_status = 'no_expiry' THEN 'no_expiry'
    WHEN validity_status = 'unknown'   THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at IS NULL THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at < CURRENT_DATE THEN 'expired'
    WHEN validity_status = 'has_expiry' AND expires_at <= (CURRENT_DATE + INTERVAL '30 days') THEN 'expiring_soon'
    WHEN validity_status = 'has_expiry' THEN 'valid'
    ELSE 'unknown'
  END AS expiration_status
FROM public.worker_sst_qualifications q
WHERE deleted_at IS NULL AND superseded_at IS NULL
ORDER BY worker_id, chain_key, issued_at DESC, created_at DESC;

CREATE VIEW public.worker_sst_qualifications_history
  WITH (security_invoker = true) AS
SELECT
  id, worker_id, nr_code, chain_key,
  training_type, issued_at, expires_at, workload_hours,
  provider_name, instructor_name, document_url, document_status,
  validity_status, source_type, revision_type,
  employment_link_document_id, link_group_worker_id, link_group_id, event_id, company_id,
  supersedes_id, superseded_at, notes, created_at, updated_at, deleted_at,
  CASE
    WHEN validity_status = 'no_expiry' THEN 'no_expiry'
    WHEN validity_status = 'unknown'   THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at IS NULL THEN 'unknown'
    WHEN validity_status = 'has_expiry' AND expires_at < CURRENT_DATE THEN 'expired'
    WHEN validity_status = 'has_expiry' AND expires_at <= (CURRENT_DATE + INTERVAL '30 days') THEN 'expiring_soon'
    WHEN validity_status = 'has_expiry' THEN 'valid'
    ELSE 'unknown'
  END AS expiration_status
FROM public.worker_sst_qualifications q
WHERE deleted_at IS NULL
ORDER BY worker_id, nr_code, issued_at DESC, created_at DESC;

REVOKE ALL ON public.worker_sst_qualifications_current  FROM anon;
REVOKE ALL ON public.worker_sst_qualifications_history  FROM anon;
GRANT SELECT ON public.worker_sst_qualifications_current TO authenticated;
GRANT SELECT ON public.worker_sst_qualifications_history TO authenticated;
GRANT ALL ON public.worker_sst_qualifications_current TO service_role;
GRANT ALL ON public.worker_sst_qualifications_history TO service_role;