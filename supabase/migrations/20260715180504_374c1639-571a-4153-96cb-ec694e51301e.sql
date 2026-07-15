
-- 1. Expand change_logs action check to record restoration events
ALTER TABLE public.change_logs DROP CONSTRAINT IF EXISTS change_logs_action_check;
ALTER TABLE public.change_logs ADD CONSTRAINT change_logs_action_check
  CHECK (action = ANY (ARRAY[
    'insert','update','delete',
    'merge_workers_success','merge_conflict','merge_payroll_item_consolidated',
    'invite_accepted','worker_restored'
  ]));

-- 2. Helper: resolve merge chain (cycle-safe, max depth 16)
CREATE OR REPLACE FUNCTION public.resolve_worker_merge_chain(_worker_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cur uuid := _worker_id;
  v_next uuid;
  v_deleted timestamptz;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_i int := 0;
BEGIN
  IF v_cur IS NULL THEN RETURN NULL; END IF;
  LOOP
    v_i := v_i + 1;
    IF v_i > 16 THEN RETURN NULL; END IF; -- chain too long
    IF v_cur = ANY(v_seen) THEN RETURN NULL; END IF; -- cycle
    v_seen := array_append(v_seen, v_cur);
    SELECT merged_into_worker_id, deleted_at INTO v_next, v_deleted
      FROM public.workers WHERE id = v_cur;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_next IS NULL THEN
      -- Reached terminal record. Only return it if active.
      IF v_deleted IS NULL THEN RETURN v_cur; ELSE RETURN NULL; END IF;
    END IF;
    v_cur := v_next;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_worker_merge_chain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_worker_merge_chain(uuid) TO authenticated, service_role;

-- 3. Rewrite ensure_worker to include merged/inactive branches
CREATE OR REPLACE FUNCTION public.ensure_worker(payload jsonb, mode text DEFAULT 'auto')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
  v_any record;
  v_principal uuid;
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

  v_full_name := trim(coalesce(payload->>'full_name',''));
  v_cpf_norm  := regexp_replace(coalesce(payload->>'cpf',''), '\D', '', 'g');
  v_email     := lower(nullif(trim(coalesce(payload->>'email','')),''));
  v_phone     := regexp_replace(coalesce(payload->>'phone_main',''), '\D', '', 'g');
  v_birth     := nullif(payload->>'birth_date','')::date;
  v_reg_status := coalesce(payload->>'registration_status','incomplete');

  IF v_full_name = '' THEN
    RAISE EXCEPTION 'missing_full_name' USING ERRCODE = '22023';
  END IF;

  IF v_cpf_norm <> '' THEN
    IF length(v_cpf_norm) <> 11 OR NOT public.is_valid_cpf(v_cpf_norm) THEN
      RAISE EXCEPTION 'invalid_cpf' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_reg_status = 'complete' THEN
    IF v_cpf_norm = '' OR NOT public.is_valid_cpf(v_cpf_norm) THEN
      RAISE EXCEPTION 'incomplete_worker_data' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 1) Active match by CPF
  IF v_cpf_norm <> '' THEN
    SELECT id INTO v_existing
      FROM public.workers
     WHERE cpf_normalized = v_cpf_norm
       AND deleted_at IS NULL
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('result','existing','workerId', v_existing);
    END IF;

    -- 2) Any (soft-deleted / merged) record with this CPF
    SELECT id, deleted_at, merged_into_worker_id
      INTO v_any
      FROM public.workers
     WHERE cpf_normalized = v_cpf_norm
     ORDER BY (merged_into_worker_id IS NOT NULL) DESC, deleted_at DESC NULLS LAST
     LIMIT 1;

    IF v_any.id IS NOT NULL THEN
      IF v_any.merged_into_worker_id IS NOT NULL THEN
        v_principal := public.resolve_worker_merge_chain(v_any.merged_into_worker_id);
        IF v_principal IS NOT NULL THEN
          RETURN jsonb_build_object(
            'result','merged',
            'workerId', v_principal,
            'mergedWorkerId', v_any.id
          );
        END IF;
        -- Chain broken/cycle: treat as inactive without restore
        RETURN jsonb_build_object(
          'result','inactive',
          'workerId', v_any.id,
          'canRestore', false
        );
      ELSE
        RETURN jsonb_build_object(
          'result','inactive',
          'workerId', v_any.id,
          'canRestore', (v_is_admin OR v_is_manager)
        );
      END IF;
    END IF;
  END IF;

  -- 3) Fuzzy (only in auto mode)
  IF mode <> 'force_create' THEN
    WITH cands AS (
      SELECT w.id, w.full_name, w.birth_date, w.cpf_normalized, w.email, w.phone_main,
             similarity(lower(w.full_name), lower(v_full_name)) AS sim
      FROM public.workers w
      WHERE w.deleted_at IS NULL
        AND (
             (v_birth IS NOT NULL AND w.birth_date = v_birth AND lower(w.full_name) = lower(v_full_name))
          OR (v_phone <> '' AND regexp_replace(coalesce(w.phone_main,''),'\D','','g') = v_phone
                AND lower(w.full_name) = lower(v_full_name))
          OR (v_email IS NOT NULL AND lower(w.email) = v_email AND lower(w.full_name) = lower(v_full_name))
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
    )), '[]'::jsonb) INTO v_matches FROM cands;

    IF jsonb_array_length(v_matches) > 0 THEN
      RETURN jsonb_build_object('result','possible_duplicate','matches', v_matches);
    END IF;
  END IF;

  -- 4) Create
  BEGIN
    INSERT INTO public.workers (
      full_name, cpf, email, phone_main, birth_date, registration_status
    ) VALUES (
      v_full_name, coalesce(payload->>'cpf',''), v_email,
      nullif(payload->>'phone_main',''), v_birth, v_reg_status
    ) RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    IF v_cpf_norm <> '' THEN
      SELECT id INTO v_existing FROM public.workers
        WHERE cpf_normalized = v_cpf_norm AND deleted_at IS NULL LIMIT 1;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('result','existing','workerId', v_existing);
      END IF;
      SELECT id, deleted_at, merged_into_worker_id INTO v_any
        FROM public.workers WHERE cpf_normalized = v_cpf_norm LIMIT 1;
      IF v_any.id IS NOT NULL THEN
        IF v_any.merged_into_worker_id IS NOT NULL THEN
          v_principal := public.resolve_worker_merge_chain(v_any.merged_into_worker_id);
          IF v_principal IS NOT NULL THEN
            RETURN jsonb_build_object('result','merged','workerId', v_principal, 'mergedWorkerId', v_any.id);
          END IF;
        END IF;
        RETURN jsonb_build_object('result','inactive','workerId', v_any.id, 'canRestore', (v_is_admin OR v_is_manager));
      END IF;
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object('result','created','workerId', v_new_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_worker(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_worker(jsonb, text) TO authenticated, service_role;

-- 4. Preview for restoration
CREATE OR REPLACE FUNCTION public.restore_worker_preview(_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w record;
  v_active_conflict uuid;
  v_profile_conflict uuid;
  v_conflicts jsonb := '[]'::jsonb;
  v_cpf_valid boolean;
  c_links int; c_lgw int; c_docs int; c_wdocs int;
  c_pay int; c_dep int; c_sst int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _worker_id IS NULL THEN RAISE EXCEPTION 'invalid_arguments' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_not_found' USING ERRCODE='22023'; END IF;

  v_cpf_valid := (v_w.cpf_normalized IS NOT NULL AND length(v_w.cpf_normalized)=11
                  AND public.is_valid_cpf(v_w.cpf_normalized));

  IF v_w.cpf_normalized IS NOT NULL AND v_w.cpf_normalized <> '' THEN
    SELECT id INTO v_active_conflict FROM public.workers
     WHERE cpf_normalized = v_w.cpf_normalized AND deleted_at IS NULL AND id <> v_w.id LIMIT 1;
    IF v_active_conflict IS NOT NULL THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code','ACTIVE_CPF_CONFLICT','workerId', v_active_conflict));
    END IF;
  END IF;

  IF v_w.linked_profile_id IS NOT NULL THEN
    SELECT id INTO v_profile_conflict FROM public.workers
     WHERE linked_profile_id = v_w.linked_profile_id AND deleted_at IS NULL AND id <> v_w.id LIMIT 1;
    IF v_profile_conflict IS NOT NULL THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code','ACTIVE_LINKED_PROFILE_CONFLICT','workerId', v_profile_conflict));
    END IF;
  END IF;

  SELECT count(*) INTO c_links  FROM public.employment_links WHERE worker_id = _worker_id;
  SELECT count(*) INTO c_lgw    FROM public.link_group_workers WHERE worker_id = _worker_id AND deleted_at IS NULL;
  SELECT count(*) INTO c_docs   FROM public.employment_link_documents WHERE worker_id = _worker_id;
  SELECT count(*) INTO c_wdocs  FROM public.worker_documents WHERE worker_id = _worker_id AND deleted_at IS NULL;
  SELECT count(*) INTO c_pay    FROM public.worker_payment_methods WHERE worker_id = _worker_id AND deleted_at IS NULL;
  SELECT count(*) INTO c_dep    FROM public.worker_dependents WHERE worker_id = _worker_id AND deleted_at IS NULL;
  SELECT count(*) INTO c_sst    FROM public.worker_sst_qualifications WHERE worker_id = _worker_id AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'result', CASE
      WHEN v_w.deleted_at IS NULL THEN 'not_deleted'
      WHEN v_w.merged_into_worker_id IS NOT NULL THEN 'merged'
      WHEN NOT v_cpf_valid THEN 'invalid_cpf'
      WHEN jsonb_array_length(v_conflicts) > 0 THEN 'blocked'
      ELSE 'ready'
    END,
    'worker', jsonb_build_object(
      'id', v_w.id,
      'full_name', v_w.full_name,
      'cpfMasked', CASE WHEN v_w.cpf_normalized <> '' THEN '***.***.***-' || right(v_w.cpf_normalized,2) ELSE NULL END,
      'birth_date', v_w.birth_date,
      'deleted_at', v_w.deleted_at,
      'merged_into_worker_id', v_w.merged_into_worker_id
    ),
    'counts', jsonb_build_object(
      'employment_links', c_links,
      'link_group_workers', c_lgw,
      'employment_link_documents', c_docs,
      'worker_documents', c_wdocs,
      'worker_payment_methods', c_pay,
      'worker_dependents', c_dep,
      'worker_sst_qualifications', c_sst
    ),
    'conflicts', v_conflicts
  );
END;
$$;
REVOKE ALL ON FUNCTION public.restore_worker_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_worker_preview(uuid) TO authenticated, service_role;

-- 5. Transactional restore
CREATE OR REPLACE FUNCTION public.restore_worker(_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w record;
  v_conflict uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _worker_id IS NULL THEN RAISE EXCEPTION 'invalid_arguments' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_w FROM public.workers WHERE id = _worker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_not_found' USING ERRCODE='22023'; END IF;

  IF v_w.deleted_at IS NULL THEN
    RAISE EXCEPTION 'worker_not_deleted' USING ERRCODE='22023';
  END IF;
  IF v_w.merged_into_worker_id IS NOT NULL THEN
    RAISE EXCEPTION 'worker_merged' USING ERRCODE='22023';
  END IF;
  IF v_w.cpf_normalized IS NULL OR length(v_w.cpf_normalized) <> 11
     OR NOT public.is_valid_cpf(v_w.cpf_normalized) THEN
    RAISE EXCEPTION 'invalid_cpf' USING ERRCODE='22023';
  END IF;

  SELECT id INTO v_conflict FROM public.workers
   WHERE cpf_normalized = v_w.cpf_normalized AND deleted_at IS NULL AND id <> v_w.id
   FOR UPDATE;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'active_cpf_conflict' USING ERRCODE='23505';
  END IF;

  IF v_w.linked_profile_id IS NOT NULL THEN
    SELECT id INTO v_conflict FROM public.workers
     WHERE linked_profile_id = v_w.linked_profile_id AND deleted_at IS NULL AND id <> v_w.id
     FOR UPDATE;
    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'active_linked_profile_conflict' USING ERRCODE='23505';
    END IF;
  END IF;

  UPDATE public.workers
     SET deleted_at = NULL,
         updated_at = now()
   WHERE id = _worker_id;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('workers', _worker_id, 'worker_restored',
          jsonb_build_object('deleted_at', v_w.deleted_at),
          jsonb_build_object('restored_at', now(), 'restored_by', v_uid),
          v_uid);

  RETURN jsonb_build_object('result','restored','workerId', _worker_id);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_worker(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_worker(uuid) TO authenticated, service_role;
