-- RPC ensure_worker(payload jsonb, mode text)
CREATE OR REPLACE FUNCTION public.ensure_worker(payload jsonb, mode text DEFAULT 'auto')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_manager boolean;
  v_is_operator boolean;
  v_full_name text;
  v_cpf_norm text;
  v_email text;
  v_phone text;
  v_birth date;
  v_reg_status text;
  v_existing uuid;
  v_matches jsonb := '[]'::jsonb;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  v_is_admin    := public.has_role(v_uid, 'admin'::public.app_role);
  v_is_manager  := public.has_role(v_uid, 'manager'::public.app_role);
  v_is_operator := public.has_role(v_uid, 'operator'::public.app_role);

  IF mode = 'force_create' THEN
    IF NOT (v_is_admin OR v_is_manager) THEN
      RAISE EXCEPTION 'forbidden_force_create' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT (v_is_admin OR v_is_manager OR v_is_operator) THEN
      RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Normalização
  v_full_name := trim(coalesce(payload->>'full_name',''));
  v_cpf_norm  := regexp_replace(coalesce(payload->>'cpf',''), '\D', '', 'g');
  v_email     := lower(nullif(trim(coalesce(payload->>'email','')),''));
  v_phone     := regexp_replace(coalesce(payload->>'phone_main',''), '\D', '', 'g');
  v_birth     := nullif(payload->>'birth_date','')::date;
  v_reg_status := coalesce(payload->>'registration_status','incomplete');

  IF v_full_name = '' THEN
    RAISE EXCEPTION 'missing_full_name' USING ERRCODE = '22023';
  END IF;

  -- Validação de CPF
  IF v_cpf_norm <> '' THEN
    IF length(v_cpf_norm) <> 11 OR NOT public.is_valid_cpf(v_cpf_norm) THEN
      RAISE EXCEPTION 'invalid_cpf' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Coerência do cadastro completo
  IF v_reg_status = 'complete' THEN
    IF v_cpf_norm = '' OR NOT public.is_valid_cpf(v_cpf_norm) THEN
      RAISE EXCEPTION 'incomplete_worker_data' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Match exato por CPF
  IF v_cpf_norm <> '' AND length(v_cpf_norm) = 11 AND public.is_valid_cpf(v_cpf_norm) THEN
    SELECT id INTO v_existing
      FROM public.workers
     WHERE cpf_normalized = v_cpf_norm
       AND deleted_at IS NULL
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('result','existing','workerId', v_existing);
    END IF;
  END IF;

  -- Divergência de schema: documento estrangeiro (document_type/document_number
  -- não existem em public.workers). Match por documento estrangeiro suprimido.

  -- Busca fuzzy (somente fora de force_create)
  IF mode <> 'force_create' THEN
    WITH cands AS (
      SELECT w.id,
             w.full_name,
             w.birth_date,
             w.cpf_normalized,
             w.email,
             w.phone_main,
             similarity(lower(w.full_name), lower(v_full_name)) AS sim
      FROM public.workers w
      WHERE w.deleted_at IS NULL
        AND w.id IS DISTINCT FROM v_existing
        AND (
             (v_birth IS NOT NULL AND w.birth_date = v_birth
                AND lower(w.full_name) = lower(v_full_name))
          OR (v_phone <> '' AND regexp_replace(coalesce(w.phone_main,''),'\D','','g') = v_phone
                AND lower(w.full_name) = lower(v_full_name))
          OR (v_email IS NOT NULL AND lower(w.email) = v_email
                AND lower(w.full_name) = lower(v_full_name))
          OR (v_birth IS NOT NULL AND w.birth_date = v_birth
                AND similarity(lower(w.full_name), lower(v_full_name)) >= 0.85)
        )
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'workerId', id,
      'nameMasked', substr(full_name,1,1) || '***',
      'birthDate', birth_date,
      'cpfMasked', CASE WHEN cpf_normalized <> '' THEN '***.***.***-' || right(cpf_normalized,2) ELSE NULL END,
      'emailMasked', CASE WHEN email IS NOT NULL THEN substr(email,1,1) || '***@' || split_part(email,'@',2) ELSE NULL END,
      'phoneLast4', right(regexp_replace(coalesce(phone_main,''),'\D','','g'), 4),
      'similarity', round(sim::numeric, 3)
    )), '[]'::jsonb) INTO v_matches
    FROM cands;

    IF jsonb_array_length(v_matches) > 0 THEN
      RETURN jsonb_build_object('result','possible_duplicate','matches', v_matches);
    END IF;
  END IF;

  -- Criação
  BEGIN
    INSERT INTO public.workers (
      full_name, cpf, email, phone_main, birth_date, registration_status
    ) VALUES (
      v_full_name,
      coalesce(payload->>'cpf',''),
      v_email,
      nullif(payload->>'phone_main',''),
      v_birth,
      v_reg_status
    ) RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concorrência: reler por CPF
    IF v_cpf_norm <> '' THEN
      SELECT id INTO v_existing
        FROM public.workers
       WHERE cpf_normalized = v_cpf_norm
         AND deleted_at IS NULL
       LIMIT 1;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('result','existing','workerId', v_existing);
      END IF;
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object('result','created','workerId', v_new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_worker(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_worker(jsonb, text) TO authenticated;