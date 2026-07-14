-- 1) Extend document_status to include 'no_document'
ALTER TABLE public.worker_sst_qualifications
  DROP CONSTRAINT IF EXISTS worker_sst_qualifications_document_status_check;
ALTER TABLE public.worker_sst_qualifications
  ADD CONSTRAINT worker_sst_qualifications_document_status_check
  CHECK (document_status = ANY (ARRAY['pending','ok','rejected','no_document']::text[]));

-- 2) New columns
ALTER TABLE public.worker_sst_qualifications
  ADD COLUMN IF NOT EXISTS employment_link_document_id uuid
    REFERENCES public.employment_link_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_group_worker_id uuid
    REFERENCES public.link_group_workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_group_id uuid
    REFERENCES public.link_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid
    REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid
    REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS revision_type text NOT NULL DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS validity_status text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.worker_sst_qualifications
  DROP CONSTRAINT IF EXISTS worker_sst_qualifications_source_type_check,
  DROP CONSTRAINT IF EXISTS worker_sst_qualifications_revision_type_check,
  DROP CONSTRAINT IF EXISTS worker_sst_qualifications_validity_status_check;

ALTER TABLE public.worker_sst_qualifications
  ADD CONSTRAINT worker_sst_qualifications_source_type_check
    CHECK (source_type = ANY (ARRAY['manual','link_document','import']::text[])),
  ADD CONSTRAINT worker_sst_qualifications_revision_type_check
    CHECK (revision_type = ANY (ARRAY['initial','renewal','replacement','additional']::text[])),
  ADD CONSTRAINT worker_sst_qualifications_validity_status_check
    CHECK (validity_status = ANY (ARRAY['has_expiry','no_expiry','unknown']::text[]));

-- Generated chain_key: NRs 'additional' têm chain próprio, demais consolidam por nr_code
ALTER TABLE public.worker_sst_qualifications
  DROP COLUMN IF EXISTS chain_key;
ALTER TABLE public.worker_sst_qualifications
  ADD COLUMN chain_key text GENERATED ALWAYS AS (
    CASE WHEN revision_type = 'additional'
         THEN nr_code || ':' || id::text
         ELSE nr_code
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_sst_qual_link_doc
  ON public.worker_sst_qualifications (employment_link_document_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sst_qual_worker_chain
  ON public.worker_sst_qualifications (worker_id, chain_key)
  WHERE deleted_at IS NULL AND superseded_at IS NULL;

-- 3) Update chain trigger: 'additional' não consolida e não é consolidada
CREATE OR REPLACE FUNCTION public.chain_sst_qualifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.revision_type = 'additional' THEN
    RETURN NEW;
  END IF;

  UPDATE public.worker_sst_qualifications
     SET superseded_at = now(),
         supersedes_id = COALESCE(supersedes_id, NEW.id)
   WHERE worker_id  = NEW.worker_id
     AND nr_code    = NEW.nr_code
     AND id        <> NEW.id
     AND deleted_at IS NULL
     AND superseded_at IS NULL
     AND revision_type <> 'additional'
     AND issued_at <= NEW.issued_at;

  RETURN NEW;
END;
$function$;

-- 4) Trigger para sincronizar rejeição/exclusão de employment_link_documents
CREATE OR REPLACE FUNCTION public.sync_sst_from_link_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Exclusão lógica do documento: limpa referência e marca no_document
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.worker_sst_qualifications
       SET employment_link_document_id = NULL,
           document_status = 'no_document',
           document_url = NULL
     WHERE employment_link_document_id = NEW.id
       AND deleted_at IS NULL;
    RETURN NEW;
  END IF;

  -- Mudança de status do documento
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'rejected' THEN
      UPDATE public.worker_sst_qualifications
         SET document_status = 'rejected'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL;
    ELSIF NEW.status IN ('approved') THEN
      UPDATE public.worker_sst_qualifications
         SET document_status = 'ok'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL
         AND document_status IN ('pending','rejected','no_document');
    ELSIF NEW.status IN ('uploaded','pending','replace') THEN
      UPDATE public.worker_sst_qualifications
         SET document_status = 'pending'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL
         AND document_status = 'no_document';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_sst_from_link_document ON public.employment_link_documents;
CREATE TRIGGER trg_sync_sst_from_link_document
  AFTER UPDATE ON public.employment_link_documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_sst_from_link_document();

-- 5) Recreate views (security_invoker=true) com novos campos + chain_key
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
    WHEN expires_at IS NULL THEN 'no_expiry'
    WHEN expires_at < CURRENT_DATE THEN 'expired'
    WHEN expires_at <= (CURRENT_DATE + INTERVAL '30 days') THEN 'expiring_soon'
    ELSE 'valid'
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
    WHEN expires_at IS NULL THEN 'no_expiry'
    WHEN expires_at < CURRENT_DATE THEN 'expired'
    WHEN expires_at <= (CURRENT_DATE + INTERVAL '30 days') THEN 'expiring_soon'
    ELSE 'valid'
  END AS expiration_status
FROM public.worker_sst_qualifications q
ORDER BY worker_id, nr_code, issued_at DESC, created_at DESC;

GRANT SELECT ON public.worker_sst_qualifications_current TO authenticated;
GRANT SELECT ON public.worker_sst_qualifications_history TO authenticated;
GRANT ALL ON public.worker_sst_qualifications_current TO service_role;
GRANT ALL ON public.worker_sst_qualifications_history TO service_role;