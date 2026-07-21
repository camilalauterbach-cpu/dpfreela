
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
  v_norm text;
  v_doc_type_id uuid;
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

  -- E-SST.1A/Fase3: resolve o document_type_id oficial via catálogo.
  v_norm := public.f_normalize_nr_code(v_nr);
  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'invalid_nr_code_format' USING ERRCODE='22023',
      HINT = 'Use o padrão NRxx (ex.: NR10, NR35).';
  END IF;
  SELECT id INTO v_doc_type_id
    FROM public.document_types
   WHERE category = 'sst_nr' AND code = v_norm;
  IF v_doc_type_id IS NULL THEN
    RAISE EXCEPTION 'nr_code_not_in_catalog' USING ERRCODE='22023',
      HINT = 'Cadastre o tipo em document_types (categoria sst_nr) antes de registrar.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || '|' || v_nr, 0)
  );

  IF v_op IN ('renewal','replacement') THEN
    IF v_prev IS NULL THEN
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

  INSERT INTO public.worker_sst_qualifications (
    worker_id, nr_code, document_type_id, training_type, issued_at, expires_at,
    workload_hours, provider_name, provider_document, instructor_name,
    document_url, document_status, validity_status, notes,
    supersedes_id, source_type, revision_type, revision_reason,
    employment_link_document_id, link_group_worker_id, link_group_id,
    event_id, company_id, created_by
  ) VALUES (
    v_worker, v_nr, v_doc_type_id,
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
    CASE v_op
      WHEN 'renewal'     THEN 'renewed'::public.sst_revision_reason
      WHEN 'replacement' THEN 'replaced'::public.sst_revision_reason
      ELSE                    'created'::public.sst_revision_reason
    END,
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
    'revision_type', v_revision,
    'document_type_id', v_doc_type_id
  );
END;
$function$;
