
-- 1) Remove acesso anon das views SST
REVOKE ALL ON public.worker_sst_qualifications_history FROM anon;
REVOKE ALL ON public.worker_sst_qualifications_current FROM anon;
GRANT SELECT ON public.worker_sst_qualifications_history TO authenticated;
GRANT SELECT ON public.worker_sst_qualifications_current  TO authenticated;

-- 2) Fluxo de novo comprovante: rejected/no_document -> pending quando doc é reanexado
CREATE OR REPLACE FUNCTION public.sync_sst_from_link_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.worker_sst_qualifications
       SET employment_link_document_id = NULL,
           document_status = 'no_document',
           document_url = NULL
     WHERE employment_link_document_id = NEW.id
       AND deleted_at IS NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'rejected' THEN
      UPDATE public.worker_sst_qualifications
         SET document_status = 'rejected'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL;
    ELSIF NEW.status = 'approved' THEN
      -- Nunca promove diretamente rejected/no_document -> ok.
      UPDATE public.worker_sst_qualifications
         SET document_status = 'ok'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL
         AND document_status = 'pending';
    ELSIF NEW.status IN ('uploaded','pending','replace') THEN
      -- Novo comprovante reabre o ciclo: rejected/no_document voltam a pending.
      UPDATE public.worker_sst_qualifications
         SET document_status = 'pending'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL
         AND document_status IN ('no_document','rejected');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
