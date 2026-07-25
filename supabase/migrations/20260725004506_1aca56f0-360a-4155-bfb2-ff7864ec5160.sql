
CREATE OR REPLACE FUNCTION public.register_sst_revision(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_worker uuid;

  v_in_doc_type_id uuid;
  v_in_nr_code_raw text;
  v_in_nr_code_norm text;
  v_expected_current uuid;
  v_expected_current_provided boolean := false;

  v_document_type_id uuid;
  v_document_type_code text;
  v_document_type_category text;
  v_document_type_active boolean;
  v_default_days int;
  v_matches int;

  v_op text;
  v_op_original text;
  v_revision text;
  v_requested_additional boolean := false;
  v_compat_mode boolean := false;

  v_issued date;
  v_expires date;
  v_validity text;
  v_expires_had_input boolean;
  v_expiry_source text;
  v_validity_days_used int;

  v_prev_rec public.worker_sst_qualifications%ROWTYPE;
  v_prev_id uuid;
  v_new_id uuid;
  v_source text;

  v_compat jsonb;
BEGIN
  -- 1) AuthZ
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  -- 2) Parse
  v_worker            := nullif(payload->>'worker_id','')::uuid;
  v_in_doc_type_id    := nullif(payload->>'document_type_id','')::uuid;
  v_in_nr_code_raw    := nullif(btrim(coalesce(payload->>'nr_code','')),'');
  v_expected_current_provided := (payload ? 'expected_current_qualification_id')
                                 AND (nullif(payload->>'expected_current_qualification_id','') IS NOT NULL);
  v_expected_current  := nullif(payload->>'expected_current_qualification_id','')::uuid;
  v_op                := lower(coalesce(payload->>'operation','initial'));
  v_op_original       := v_op;
  v_prev_id           := nullif(payload->>'previous_qualification_id','')::uuid;
  v_issued            := nullif(payload->>'issued_at','')::date;
  v_expires_had_input := (nullif(payload->>'expires_at','') IS NOT NULL);
  v_expires           := nullif(payload->>'expires_at','')::date;
  v_validity          := coalesce(payload->>'validity_status','unknown');
  v_source            := coalesce(payload->>'source_type','manual');

  IF v_op = 'create' THEN v_op := 'initial'; END IF;
  IF v_op = 'correct' THEN v_op := 'correction'; END IF;

  IF v_op NOT IN ('initial','renewal','replacement','correction','additional') THEN
    RAISE EXCEPTION 'invalid_operation' USING ERRCODE='22023';
  END IF;

  v_revision := CASE v_op
                  WHEN 'renewal'     THEN 'renewal'
                  WHEN 'replacement' THEN 'replacement'
                  WHEN 'correction'  THEN 'replacement'
                  WHEN 'additional'  THEN 'additional'
                  ELSE 'initial'
                END;

  IF v_worker IS NULL THEN RAISE EXCEPTION 'missing_worker_id' USING ERRCODE='22023'; END IF;
  IF v_issued IS NULL THEN RAISE EXCEPTION 'missing_issued_at' USING ERRCODE='22023'; END IF;
  IF v_source NOT IN ('manual','link_document','import') THEN
    RAISE EXCEPTION 'invalid_source_type' USING ERRCODE='22023';
  END IF;

  -- 3) Resolução canônica: document_type_id vs nr_code legado
  IF v_in_doc_type_id IS NULL AND v_in_nr_code_raw IS NULL THEN
    RAISE EXCEPTION 'document_type_required' USING ERRCODE='22023',
      HINT='Envie document_type_id (preferido) ou nr_code.';
  END IF;

  IF v_in_doc_type_id IS NOT NULL THEN
    -- Preferimos identidade canônica: resolvemos o tipo ANTES de validar nr_code.
    SELECT id, code, category, is_active, default_validity_days
      INTO v_document_type_id, v_document_type_code, v_document_type_category,
           v_document_type_active, v_default_days
      FROM public.document_types
     WHERE id = v_in_doc_type_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown_document_type' USING ERRCODE='22023';
    END IF;

    -- Q-024-D-TRAINING-FIX §2/§3: validação de formato NR e reconciliação com
    -- nr_code SÓ se aplicam a sst_nr. Treinamento nunca passa por f_normalize_nr_code.
    IF v_document_type_category = 'sst_nr' AND v_in_nr_code_raw IS NOT NULL THEN
      v_in_nr_code_norm := public.f_normalize_nr_code(v_in_nr_code_raw);
      IF v_in_nr_code_norm IS NULL THEN
        RAISE EXCEPTION 'invalid_nr_code_format' USING ERRCODE='22023',
          HINT='Use o padrão NRxx (ex.: NR10, NR35).';
      END IF;
      IF public.f_normalize_nr_code(v_document_type_code) IS DISTINCT FROM v_in_nr_code_norm THEN
        RAISE EXCEPTION 'document_type_code_mismatch' USING ERRCODE='22023',
          HINT='document_type_id e nr_code apontam para tipos diferentes.';
      END IF;
      v_compat := jsonb_build_object(
        'source','both_verified',
        'raw_nr_code', v_in_nr_code_raw,
        'normalized_nr_code', v_in_nr_code_norm,
        'resolved_document_type_id', v_document_type_id
      );
    ELSE
      -- training (ou sst_nr sem nr_code): identidade puramente pelo UUID.
      v_compat := jsonb_build_object(
        'source','document_type_id',
        'raw_nr_code', v_in_nr_code_raw,
        'normalized_nr_code', NULL,
        'resolved_document_type_id', v_document_type_id,
        'category', v_document_type_category
      );
    END IF;
  ELSE
    -- Fluxo legado só por nr_code: restrito a sst_nr.
    v_in_nr_code_norm := public.f_normalize_nr_code(v_in_nr_code_raw);
    IF v_in_nr_code_norm IS NULL THEN
      -- Se o texto não é NR válido, orientar o usuário a selecionar do catálogo
      -- (provavelmente é um treinamento).
      RAISE EXCEPTION 'training_document_type_id_required' USING ERRCODE='22023',
        HINT='Selecione o tipo no catálogo (document_type_id). Fluxo legado por nr_code aceita apenas NRs.';
    END IF;
    SELECT count(*) INTO v_matches
      FROM public.document_types
     WHERE category='sst_nr'
       AND public.f_normalize_nr_code(code) = v_in_nr_code_norm;
    IF v_matches = 0 THEN
      RAISE EXCEPTION 'unknown_document_type' USING ERRCODE='22023',
        HINT='Nenhum document_type sst_nr corresponde ao código informado.';
    ELSIF v_matches > 1 THEN
      RAISE EXCEPTION 'ambiguous_document_type' USING ERRCODE='22023',
        HINT='Mais de um document_type sst_nr responde ao código; envie document_type_id.';
    END IF;
    SELECT id, code, category, is_active, default_validity_days
      INTO v_document_type_id, v_document_type_code, v_document_type_category,
           v_document_type_active, v_default_days
      FROM public.document_types
     WHERE category='sst_nr'
       AND public.f_normalize_nr_code(code) = v_in_nr_code_norm;
    v_compat_mode := true;
    v_compat := jsonb_build_object(
      'source','legacy_nr_code',
      'raw_nr_code', v_in_nr_code_raw,
      'normalized_nr_code', v_in_nr_code_norm,
      'resolved_document_type_id', v_document_type_id
    );
  END IF;

  -- 4) Storage flow gate: aceita sst_nr e training. ASO permanece em worker_documents.
  IF v_document_type_category NOT IN ('sst_nr','training') THEN
    RAISE EXCEPTION 'qualification_storage_flow_not_supported' USING ERRCODE='22023',
      HINT='register_sst_revision aceita apenas document_types de categoria sst_nr ou training.';
  END IF;

  IF v_document_type_active IS DISTINCT FROM true
     AND v_op IN ('initial','additional') THEN
    RAISE EXCEPTION 'document_type_inactive' USING ERRCODE='22023';
  END IF;

  -- 5) Validade
  v_expiry_source := 'explicit';
  v_validity_days_used := NULL;
  IF v_validity = 'has_expiry' AND v_expires IS NULL
     AND v_default_days IS NOT NULL AND v_default_days > 0 THEN
    v_expires := v_issued + (v_default_days || ' days')::interval;
    v_expiry_source := 'document_type_default';
    v_validity_days_used := v_default_days;
  ELSIF v_expires_had_input THEN
    v_validity_days_used := (v_expires - v_issued);
  END IF;
  IF v_validity = 'has_expiry' AND (v_expires IS NULL OR v_expires <= v_issued) THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE='22023';
  END IF;

  -- 6) Advisory lock canônico: worker + document_type
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_worker::text || ':' || v_document_type_id::text, 42)
  );

  -- 7) Lookup vigente (após o lock)
  SELECT * INTO v_prev_rec
    FROM public.worker_sst_qualifications
   WHERE worker_id = v_worker
     AND document_type_id = v_document_type_id
     AND superseded_at IS NULL
     AND deleted_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    PERFORM 1 FROM public.worker_sst_qualifications
      WHERE worker_id = v_worker
        AND document_type_id = v_document_type_id
        AND superseded_at IS NULL
        AND deleted_at IS NULL
        AND id <> v_prev_rec.id
      LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'invariant_violation_multiple_current_qualifications' USING ERRCODE='40001';
    END IF;
  END IF;

  IF v_expected_current_provided THEN
    IF v_prev_rec.id IS DISTINCT FROM v_expected_current THEN
      RAISE EXCEPTION 'stale_current_qualification'
        USING ERRCODE = '40001',
              DETAIL = jsonb_build_object(
                'expected_current_qualification_id', v_expected_current,
                'actual_current_qualification_id', v_prev_rec.id,
                'worker_id', v_worker,
                'document_type_id', v_document_type_id
              )::text,
              HINT = 'A versão vigente mudou desde a última leitura; recarregue e tente novamente.';
    END IF;
  END IF;

  IF v_prev_id IS NOT NULL
     AND (v_prev_rec.id IS NULL OR v_prev_rec.id <> v_prev_id) THEN
    RAISE EXCEPTION 'previous_chain_mismatch' USING ERRCODE='22023';
  END IF;

  -- 8) Branch por operação
  IF v_op = 'additional' THEN
    v_requested_additional := true;
    IF v_prev_rec.id IS NOT NULL THEN
      RAISE EXCEPTION 'additional_conflicts_with_current' USING ERRCODE='22023',
        HINT='Já existe uma qualificação vigente deste tipo. Use renovação ou substituição.';
    END IF;
    v_op := 'initial';
    v_revision := 'initial';
    v_compat_mode := true;
  END IF;

  IF v_op = 'initial' THEN
    IF v_prev_rec.id IS NOT NULL THEN
      RAISE EXCEPTION 'qualification_current_version_exists' USING ERRCODE='22023',
        HINT='Já existe versão vigente deste tipo para o trabalhador.';
    END IF;
    v_prev_id := NULL;
  ELSE
    IF v_prev_rec.id IS NULL THEN
      RAISE EXCEPTION 'no_current_qualification_to_revise' USING ERRCODE='22023';
    END IF;
    v_prev_id := v_prev_rec.id;

    UPDATE public.worker_sst_qualifications
       SET superseded_at = now()
     WHERE id = v_prev_id
       AND superseded_at IS NULL;
  END IF;

  -- 9) INSERT canônico. Para training, nr_code recebe o code do catálogo
  -- (projeção legada não-identidade); para sst_nr, o code canônico é a NR.
  INSERT INTO public.worker_sst_qualifications (
    worker_id, nr_code, document_type_id, training_type, issued_at, expires_at,
    workload_hours, provider_name, provider_document, instructor_name,
    document_url, document_status, validity_status, notes,
    supersedes_id, source_type, revision_type, revision_reason,
    employment_link_document_id, link_group_worker_id, link_group_id,
    event_id, company_id, created_by
  ) VALUES (
    v_worker,
    v_document_type_code,
    v_document_type_id,
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
    v_prev_id,
    v_source, v_revision,
    CASE
      WHEN v_op = 'renewal'     THEN 'renewed'::public.sst_revision_reason
      WHEN v_op = 'replacement' THEN 'replaced'::public.sst_revision_reason
      WHEN v_op = 'correction'  THEN 'corrected'::public.sst_revision_reason
      ELSE                          'created'::public.sst_revision_reason
    END,
    nullif(payload->>'employment_link_document_id','')::uuid,
    nullif(payload->>'link_group_worker_id','')::uuid,
    nullif(payload->>'link_group_id','')::uuid,
    nullif(payload->>'event_id','')::uuid,
    nullif(payload->>'company_id','')::uuid,
    v_uid
  ) RETURNING id INTO v_new_id;

  -- 10) Auditoria ATÔMICA
  INSERT INTO public.change_logs (table_name, record_id, action, new_data, changed_by)
  VALUES (
    'worker_sst_qualifications',
    v_new_id,
    'register_sst_revision',
    jsonb_build_object(
      'worker_id', v_worker,
      'document_type_id', v_document_type_id,
      'document_type_code', v_document_type_code,
      'document_type_category', v_document_type_category,
      'operation', v_op_original,
      'revision_type', v_revision,
      'issued_at', v_issued,
      'expires_at', v_expires,
      'validity_status', v_validity,
      'expiry_source', v_expiry_source,
      'validity_days_used', v_validity_days_used,
      'source_type', v_source,
      'previous_qualification_id', v_prev_id,
      'new_qualification_id', v_new_id,
      'compat', v_compat
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_qualification_id', v_new_id,
    'previous_qualification_id', v_prev_id,
    'document_type_id', v_document_type_id,
    'document_type_code', v_document_type_code,
    'document_type_category', v_document_type_category,
    'operation', v_op_original,
    'revision_type', v_revision,
    'compat', v_compat
  );
END;
$function$;
