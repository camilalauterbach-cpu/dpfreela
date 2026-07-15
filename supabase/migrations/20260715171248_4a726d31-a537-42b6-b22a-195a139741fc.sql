
DO $$
DECLARE
  v_admin uuid := '0ecc49c7-f1f6-4130-af3f-ef4d305a9637';
  v_primary uuid;
  v_secondary uuid;
  v_link_id uuid;
  v_preview jsonb;
  v_merge jsonb;
  v_merge2 jsonb;
  v_secondary_after record;
  v_primary_after record;
  v_orphans int;
  v_change_log_count int;
  v_transferred_links int;
  v_transferred_docs int;
  v_bad_conf_error text;
  v_original_role text := current_setting('role', true);
BEGIN
  INSERT INTO public.workers (full_name, cpf, email, registration_status)
    VALUES ('TESTE MERGE Primario', '12345678909', 'teste.merge.p@example.invalid', 'complete')
    RETURNING id INTO v_primary;
  INSERT INTO public.workers (full_name, cpf, email, registration_status)
    VALUES ('TESTE MERGE Secundario', '98765432100', 'teste.merge.s@example.invalid', 'complete')
    RETURNING id INTO v_secondary;

  INSERT INTO public.employment_links (worker_id) VALUES (v_secondary) RETURNING id INTO v_link_id;
  INSERT INTO public.employment_link_documents (
    employment_link_id, worker_id, document_type, file_path, file_name, status
  ) VALUES (v_link_id, v_secondary, 'other', 'test-merge/dummy.pdf', 'dummy.pdf', 'pending');
  RAISE NOTICE 'TEST | created primary=% secondary=% link=%', v_primary, v_secondary, v_link_id;

  -- Impersonar admin apenas para chamadas de RPC
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  v_preview := public.merge_workers_preview(v_primary, v_secondary);
  RAISE NOTICE 'TEST | preview result=% counts=% conflicts=%',
    v_preview->>'result', v_preview->'counts', jsonb_array_length(v_preview->'conflicts');
  IF v_preview->>'result' <> 'ready' THEN RAISE EXCEPTION 'preview not ready: %', v_preview; END IF;
  IF jsonb_array_length(v_preview->'conflicts') <> 0 THEN RAISE EXCEPTION 'unexpected conflicts'; END IF;

  BEGIN
    PERFORM public.merge_workers(v_primary, v_secondary, 'nao-confere');
    v_bad_conf_error := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN v_bad_conf_error := SQLERRM;
  END;
  RAISE NOTICE 'TEST | invalid confirmation blocked with: %', v_bad_conf_error;
  IF v_bad_conf_error NOT LIKE '%confirmation_required%' THEN
    RAISE EXCEPTION 'invalid confirmation not blocked: %', v_bad_conf_error;
  END IF;

  v_merge := public.merge_workers(v_primary, v_secondary, 'CONFIRMAR');
  RAISE NOTICE 'TEST | merge result=% transferred=%', v_merge->>'result', v_merge->'transferred';
  IF v_merge->>'result' <> 'merged' THEN RAISE EXCEPTION 'merge failed: %', v_merge; END IF;

  BEGIN
    v_merge2 := public.merge_workers(v_primary, v_secondary, 'CONFIRMAR');
    RAISE EXCEPTION 'second merge unexpectedly succeeded: %', v_merge2;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST | second merge blocked with: %', SQLERRM;
    IF SQLERRM NOT LIKE '%secondary_not_found%' THEN
      RAISE EXCEPTION 'second merge blocked with wrong error: %', SQLERRM;
    END IF;
  END;

  -- Reset role para operações administrativas de verificação/cleanup
  PERFORM set_config('role', COALESCE(NULLIF(v_original_role,''), 'postgres'), true);
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;

  SELECT count(*) INTO v_transferred_links
    FROM public.employment_links WHERE id=v_link_id AND worker_id=v_primary;
  SELECT count(*) INTO v_transferred_docs
    FROM public.employment_link_documents WHERE employment_link_id=v_link_id AND worker_id=v_primary;
  RAISE NOTICE 'TEST | transferred links=% docs=%', v_transferred_links, v_transferred_docs;
  IF v_transferred_links<>1 OR v_transferred_docs<>1 THEN RAISE EXCEPTION 'relations not transferred'; END IF;

  SELECT * INTO v_secondary_after FROM public.workers WHERE id=v_secondary;
  RAISE NOTICE 'TEST | secondary after: deleted_at=% merged_into=% merged_by=%',
    v_secondary_after.deleted_at, v_secondary_after.merged_into_worker_id, v_secondary_after.merged_by;
  IF v_secondary_after.deleted_at IS NULL
     OR v_secondary_after.merged_into_worker_id <> v_primary
     OR v_secondary_after.merged_by <> v_admin THEN
    RAISE EXCEPTION 'secondary not finalized';
  END IF;

  SELECT * INTO v_primary_after FROM public.workers WHERE id=v_primary;
  IF v_primary_after.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'primary soft-deleted'; END IF;

  SELECT count(*) INTO v_change_log_count
    FROM public.change_logs
    WHERE table_name='workers' AND record_id=v_secondary AND action='merge_workers_success';
  RAISE NOTICE 'TEST | change_logs merge_workers_success rows=%', v_change_log_count;
  IF v_change_log_count < 1 THEN RAISE EXCEPTION 'change_logs missing'; END IF;

  SELECT
      (SELECT count(*) FROM public.employment_links WHERE worker_id=v_secondary)
    + (SELECT count(*) FROM public.employment_link_documents WHERE worker_id=v_secondary)
    + (SELECT count(*) FROM public.link_group_workers WHERE worker_id=v_secondary AND deleted_at IS NULL)
    + (SELECT count(*) FROM public.worker_documents WHERE worker_id=v_secondary)
    + (SELECT count(*) FROM public.payroll_batch_items WHERE worker_id=v_secondary AND deleted_at IS NULL)
    + (SELECT count(*) FROM public.worker_payment_methods WHERE worker_id=v_secondary AND deleted_at IS NULL)
    + (SELECT count(*) FROM public.worker_dependents WHERE worker_id=v_secondary AND deleted_at IS NULL)
  INTO v_orphans;
  RAISE NOTICE 'TEST | active refs to secondary=%', v_orphans;
  IF v_orphans <> 0 THEN RAISE EXCEPTION 'orphan refs remain'; END IF;

  DELETE FROM public.employment_link_documents WHERE employment_link_id = v_link_id;
  DELETE FROM public.employment_links WHERE id = v_link_id;
  DELETE FROM public.change_logs WHERE record_id IN (v_primary, v_secondary);
  DELETE FROM public.workers WHERE id IN (v_primary, v_secondary);
  RAISE NOTICE 'TEST | cleanup done — no fictitious records remain';
  RAISE NOTICE 'TEST | ALL CHECKS PASSED';
END $$;
