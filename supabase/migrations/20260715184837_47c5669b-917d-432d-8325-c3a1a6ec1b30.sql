
DO $$
DECLARE
  v_admin uuid := '0ecc49c7-f1f6-4130-af3f-ef4d305a9637';
  v_manager uuid := '42576275-fd4f-4dc1-893f-12a5d96afab0';
  v_operator uuid := gen_random_uuid();
  v_op_profile uuid;
  v_inactive_id uuid := gen_random_uuid();
  v_merged_secondary uuid := gen_random_uuid();
  v_merged_primary uuid := gen_random_uuid();
  v_conflict_active uuid := gen_random_uuid();
  v_conflict_deleted uuid := gen_random_uuid();
  v_result jsonb;
  v_deleted_at timestamptz;
  v_log_count int;
BEGIN
  INSERT INTO auth.users(id, instance_id, email, aud, role, encrypted_password, created_at, updated_at)
  VALUES (v_operator, '00000000-0000-0000-0000-000000000000', 'e10-op-'||replace(v_operator::text,'-','')||'@test.local',
          'authenticated','authenticated','', now(), now());
  SELECT id INTO v_op_profile FROM public.profiles WHERE user_id = v_operator;
  IF v_op_profile IS NULL THEN
    INSERT INTO public.profiles(user_id, full_name) VALUES (v_operator, '[E10] Operator') RETURNING id INTO v_op_profile;
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_operator, 'operator');

  INSERT INTO public.workers(id, full_name, cpf, birth_date, registration_status, deleted_at)
    VALUES (v_inactive_id, '[E10] Inactive', '93541134780', '1990-01-01', 'complete', now() - interval '10 days');
  INSERT INTO public.workers(id, full_name, cpf, birth_date, registration_status)
    VALUES (v_merged_primary, '[E10] Merged Primary', '15350946056', '1985-05-05', 'complete');
  INSERT INTO public.workers(id, full_name, cpf, birth_date, registration_status, deleted_at, merged_into_worker_id, merged_at, merged_by)
    VALUES (v_merged_secondary, '[E10] Merged Secondary', '39053344705', '1985-05-05', 'complete', now(), v_merged_primary, now(), v_admin);
  INSERT INTO public.workers(id, full_name, cpf, birth_date, registration_status, linked_profile_id)
    VALUES (v_conflict_active, '[E10] Conflict Active', '10433218100', '1988-08-08', 'complete', v_op_profile);
  INSERT INTO public.workers(id, full_name, cpf, birth_date, registration_status, deleted_at, linked_profile_id)
    VALUES (v_conflict_deleted, '[E10] Conflict Deleted', '96001338914', '1988-08-08', 'complete', now(), v_op_profile);

  -- S1 admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  v_result := public.ensure_worker(jsonb_build_object('full_name','X','cpf','935.411.347-80','registration_status','incomplete'));
  RAISE NOTICE 'S1 admin ensure => %', v_result;
  IF v_result->>'result' <> 'inactive' OR (v_result->>'canRestore')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL S1'; END IF;
  v_result := public.restore_worker_preview(v_inactive_id);
  IF v_result->>'result' <> 'ready' THEN RAISE EXCEPTION 'FAIL S1 preview: %', v_result; END IF;
  v_result := public.restore_worker(v_inactive_id);
  RAISE NOTICE 'S1 restore => %', v_result;
  SELECT deleted_at INTO v_deleted_at FROM public.workers WHERE id = v_inactive_id;
  IF v_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL S1 deleted_at'; END IF;
  SELECT count(*) INTO v_log_count FROM public.change_logs WHERE record_id = v_inactive_id AND action='worker_restored';
  IF v_log_count <> 1 THEN RAISE EXCEPTION 'FAIL S1 log %', v_log_count; END IF;

  -- S2 segunda restauração => worker_not_deleted
  BEGIN
    PERFORM public.restore_worker(v_inactive_id);
    RAISE EXCEPTION 'FAIL S2';
  EXCEPTION WHEN sqlstate '22023' THEN
    IF SQLERRM NOT LIKE '%worker_not_deleted%' THEN RAISE EXCEPTION 'FAIL S2 msg %', SQLERRM; END IF;
    RAISE NOTICE 'S2 ok';
  END;
  SELECT count(*) INTO v_log_count FROM public.change_logs WHERE record_id = v_inactive_id AND action='worker_restored';
  IF v_log_count <> 1 THEN RAISE EXCEPTION 'FAIL S2 extra log'; END IF;

  -- S3 operator: inactive + canRestore=false; RPCs bloqueadas
  UPDATE public.workers SET deleted_at = now() WHERE id = v_inactive_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_operator::text, 'role','authenticated')::text, true);
  v_result := public.ensure_worker(jsonb_build_object('full_name','X','cpf','935.411.347-80','registration_status','incomplete'));
  RAISE NOTICE 'S3 operator ensure => %', v_result;
  IF v_result->>'result' <> 'inactive' OR (v_result->>'canRestore')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL S3'; END IF;
  BEGIN PERFORM public.restore_worker(v_inactive_id); RAISE EXCEPTION 'FAIL S3 restore';
  EXCEPTION WHEN sqlstate '42501' THEN RAISE NOTICE 'S3 restore forbidden ok'; END;
  BEGIN PERFORM public.restore_worker_preview(v_inactive_id); RAISE EXCEPTION 'FAIL S3 preview';
  EXCEPTION WHEN sqlstate '42501' THEN RAISE NOTICE 'S3 preview forbidden ok'; END;

  -- S4 merged
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  v_result := public.ensure_worker(jsonb_build_object('full_name','X','cpf','390.533.447-05','registration_status','incomplete'));
  RAISE NOTICE 'S4 merged ensure => %', v_result;
  IF v_result->>'result' <> 'merged'
     OR v_result->>'workerId' <> v_merged_primary::text
     OR v_result->>'mergedWorkerId' <> v_merged_secondary::text THEN RAISE EXCEPTION 'FAIL S4'; END IF;
  BEGIN PERFORM public.restore_worker(v_merged_secondary); RAISE EXCEPTION 'FAIL S4b';
  EXCEPTION WHEN sqlstate '22023' THEN
    IF SQLERRM NOT LIKE '%worker_merged%' THEN RAISE EXCEPTION 'FAIL S4b msg %', SQLERRM; END IF;
    RAISE NOTICE 'S4b merged blocked ok';
  END;

  -- S5 conflito
  v_result := public.restore_worker_preview(v_conflict_deleted);
  RAISE NOTICE 'S5 preview => %', v_result;
  IF v_result->>'result' <> 'blocked' THEN RAISE EXCEPTION 'FAIL S5 preview'; END IF;
  BEGIN PERFORM public.restore_worker(v_conflict_deleted); RAISE EXCEPTION 'FAIL S5';
  EXCEPTION WHEN sqlstate '23505' THEN RAISE NOTICE 'S5 conflict blocked ok'; END;

  -- S6 manager
  UPDATE public.workers SET linked_profile_id = NULL WHERE id = v_conflict_active;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role','authenticated')::text, true);
  v_result := public.restore_worker_preview(v_conflict_deleted);
  IF v_result->>'result' <> 'ready' THEN RAISE EXCEPTION 'FAIL S6 preview: %', v_result; END IF;
  v_result := public.restore_worker(v_conflict_deleted);
  RAISE NOTICE 'S6 => %', v_result;
  IF v_result->>'result' <> 'restored' THEN RAISE EXCEPTION 'FAIL S6'; END IF;

  RAISE NOTICE '==== ENTREGA 10 — TODOS OS CENÁRIOS PASSARAM ====';

  DELETE FROM public.change_logs
    WHERE record_id IN (v_inactive_id, v_merged_secondary, v_merged_primary, v_conflict_active, v_conflict_deleted);
  DELETE FROM public.workers
    WHERE id IN (v_inactive_id, v_merged_secondary, v_merged_primary, v_conflict_active, v_conflict_deleted);
  DELETE FROM public.user_roles WHERE user_id = v_operator;
  DELETE FROM public.profiles WHERE user_id = v_operator;
  DELETE FROM auth.users WHERE id = v_operator;
END $$;
