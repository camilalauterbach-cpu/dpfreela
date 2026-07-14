
-- 1) Recreate history view: hide deliberately deleted, keep superseded
DROP VIEW IF EXISTS public.worker_sst_qualifications_history;
CREATE VIEW public.worker_sst_qualifications_history
WITH (security_invoker = true) AS
SELECT
  id, worker_id, nr_code, chain_key,
  training_type, issued_at, expires_at,
  workload_hours, provider_name, instructor_name,
  document_url, document_status, validity_status,
  source_type, revision_type,
  employment_link_document_id, link_group_worker_id,
  link_group_id, event_id, company_id,
  supersedes_id, superseded_at, notes,
  created_at, updated_at, deleted_at,
  CASE
    WHEN validity_status = 'no_expiry' THEN 'no_expiry'
    WHEN expires_at IS NULL THEN 'no_expiry'
    WHEN expires_at < CURRENT_DATE THEN 'expired'
    WHEN expires_at <= (CURRENT_DATE + INTERVAL '30 days') THEN 'expiring_soon'
    ELSE 'valid'
  END AS expiration_status
FROM public.worker_sst_qualifications q
WHERE deleted_at IS NULL
ORDER BY worker_id, nr_code, issued_at DESC, created_at DESC;

GRANT SELECT ON public.worker_sst_qualifications_history TO authenticated;
GRANT SELECT ON public.worker_sst_qualifications_history TO anon;

-- 2) Sync trigger: never auto-promote rejected/no_document without a new document
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
      -- Só promove pending -> ok. rejected/no_document exigem novo comprovante explícito.
      UPDATE public.worker_sst_qualifications
         SET document_status = 'ok'
       WHERE employment_link_document_id = NEW.id
         AND deleted_at IS NULL
         AND document_status = 'pending';
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

-- 3) Transactional RPC: register_sst_revision
--    Operations: 'initial' | 'renewal' | 'replacement' | 'additional'
--    Atomic: locks chain, validates prior, inserts new. Superseding is handled by
--    trg_chain_sst_qualifications (non-additional revisions supersede active peers in same chain).
CREATE OR REPLACE FUNCTION public.register_sst_revision(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_worker uuid;
  v_nr text;
  v_op text;
  v_prev uuid;
  v_issued date;
  v_expires date;
  v_validity text;
  v_new_id uuid;
  v_prev_rec record;
  v_source text;
  v_revision text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  v_worker  := (payload->>'worker_id')::uuid;
  v_nr      := upper(btrim(coalesce(payload->>'nr_code','')));
  v_op      := coalesce(payload->>'operation','initial');
  v_prev    := nullif(payload->>'previous_qualification_id','')::uuid;
  v_issued  := nullif(payload->>'issued_at','')::date;
  v_expires := nullif(payload->>'expires_at','')::date;
  v_validity := coalesce(payload->>'validity_status','unknown');
  v_source  := coalesce(payload->>'source_type','manual');
  v_revision := CASE v_op
                  WHEN 'renewal' THEN 'renewal'
                  WHEN 'replacement' THEN 'replacement'
                  WHEN 'additional' THEN 'additional'
                  ELSE 'initial'
                END;

  IF v_worker IS NULL THEN RAISE EXCEPTION 'missing_worker_id' USING ERRCODE='22023'; END IF;
  IF v_nr = '' THEN RAISE EXCEPTION 'missing_nr_code' USING ERRCODE='22023'; END IF;
  IF v_issued IS NULL THEN RAISE EXCEPTION 'missing_issued_at' USING ERRCODE='22023'; END IF;
  IF v_source NOT IN ('manual','link_document','import') THEN
    RAISE EXCEPTION 'invalid_source_type' USING ERRCODE='22023';
  END IF;
  IF v_validity = 'has_expiry' AND (v_expires IS NULL OR v_expires <= v_issued) THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE='22023';
  END IF;

  -- Lock lógico da cadeia (worker_id + nr_code) para toda a transação
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || '|' || v_nr, 0)
  );

  -- Valida revisão anterior quando aplicável
  IF v_op IN ('renewal','replacement') THEN
    IF v_prev IS NULL THEN
      -- Descobrir a ativa principal da cadeia
      SELECT * INTO v_prev_rec
        FROM public.worker_sst_qualifications
       WHERE worker_id = v_worker
         AND nr_code   = v_nr
         AND revision_type <> 'additional'
         AND deleted_at IS NULL
         AND superseded_at IS NULL
       ORDER BY issued_at DESC, created_at DESC
       LIMIT 1
       FOR UPDATE;
      v_prev := v_prev_rec.id;
    ELSE
      SELECT * INTO v_prev_rec
        FROM public.worker_sst_qualifications
       WHERE id = v_prev
       FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'previous_not_found' USING ERRCODE='22023'; END IF;
      IF v_prev_rec.worker_id <> v_worker OR v_prev_rec.nr_code <> v_nr THEN
        RAISE EXCEPTION 'previous_chain_mismatch' USING ERRCODE='22023';
      END IF;
      IF v_prev_rec.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'previous_deleted' USING ERRCODE='22023';
      END IF;
      IF v_prev_rec.revision_type = 'additional' THEN
        RAISE EXCEPTION 'previous_is_additional' USING ERRCODE='22023';
      END IF;
    END IF;
  END IF;

  -- Insere a nova versão. O trigger trg_chain_sst_qualifications encerra
  -- automaticamente peers ativos da mesma cadeia via superseded_at,
  -- preservando o histórico (deleted_at permanece NULL).
  INSERT INTO public.worker_sst_qualifications (
    worker_id, nr_code, training_type, issued_at, expires_at,
    workload_hours, provider_name, provider_document, instructor_name,
    document_url, document_status, validity_status, notes,
    supersedes_id, source_type, revision_type,
    employment_link_document_id, link_group_worker_id, link_group_id,
    event_id, company_id, created_by
  ) VALUES (
    v_worker, v_nr,
    nullif(btrim(coalesce(payload->>'training_type','')),''),
    v_issued, v_expires,
    nullif(payload->>'workload_hours','')::numeric,
    nullif(btrim(coalesce(payload->>'provider_name','')),''),
    nullif(btrim(coalesce(payload->>'provider_document','')),''),
    nullif(btrim(coalesce(payload->>'instructor_name','')),''),
    nullif(btrim(coalesce(payload->>'document_url','')),''),
    coalesce(payload->>'document_status','pending'),
    v_validity,
    nullif(btrim(coalesce(payload->>'notes','')),''),
    CASE WHEN v_op IN ('renewal','replacement') THEN v_prev ELSE NULL END,
    v_source, v_revision,
    nullif(payload->>'employment_link_document_id','')::uuid,
    nullif(payload->>'link_group_worker_id','')::uuid,
    nullif(payload->>'link_group_id','')::uuid,
    nullif(payload->>'event_id','')::uuid,
    nullif(payload->>'company_id','')::uuid,
    v_uid
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'result','ok',
    'qualification_id', v_new_id,
    'previous_qualification_id', v_prev,
    'revision_type', v_revision
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_sst_revision(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_sst_revision(jsonb) TO authenticated;
