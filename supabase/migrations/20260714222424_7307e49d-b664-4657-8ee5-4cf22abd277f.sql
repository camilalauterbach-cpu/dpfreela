-- merge_workers v1
CREATE OR REPLACE FUNCTION public.merge_workers(
  _primary uuid,
  _secondary uuid,
  _confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_primary record;
  v_secondary record;
  v_conflicts jsonb := '[]'::jsonb;
  v_dep_conf jsonb;
  v_pay_conf jsonb;
  v_prof_conf jsonb;
  v_transferred jsonb := jsonb_build_object();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _primary IS NULL OR _secondary IS NULL OR _primary = _secondary THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_primary   FROM public.workers WHERE id = _primary   FOR UPDATE;
  IF NOT FOUND OR v_primary.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'primary_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_secondary FROM public.workers WHERE id = _secondary FOR UPDATE;
  IF NOT FOUND OR v_secondary.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'secondary_not_found' USING ERRCODE = '22023';
  END IF;

  -- Confirmação: nome do primário OU literal 'CONFIRMAR'
  IF _confirmation IS NULL
     OR (lower(trim(_confirmation)) <> lower(trim(v_primary.full_name))
         AND upper(trim(_confirmation)) <> 'CONFIRMAR') THEN
    RAISE EXCEPTION 'confirmation_required' USING ERRCODE = '22023';
  END IF;

  -- =============== FASE DE DETECÇÃO ===============

  -- Conflito: dependentes com nome+nascimento iguais e sem CPF conclusivo
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'primary_id', p.id, 'secondary_id', s.id,
    'full_name', p.full_name, 'birth_date', p.birth_date
  )), '[]'::jsonb) INTO v_dep_conf
  FROM public.worker_dependents p
  JOIN public.worker_dependents s
    ON lower(coalesce(p.full_name,'')) = lower(coalesce(s.full_name,''))
   AND p.birth_date IS NOT DISTINCT FROM s.birth_date
   AND (
     coalesce(regexp_replace(coalesce(p.cpf,''),'\D','','g'),'') = ''
     OR coalesce(regexp_replace(coalesce(s.cpf,''),'\D','','g'),'') = ''
     OR regexp_replace(coalesce(p.cpf,''),'\D','','g') <> regexp_replace(coalesce(s.cpf,''),'\D','','g')
   )
  WHERE p.worker_id = _primary AND p.deleted_at IS NULL
    AND s.worker_id = _secondary AND s.deleted_at IS NULL;

  IF jsonb_array_length(v_dep_conf) > 0 THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code','MERGE_CONFLICT_DEPENDENTS','records', v_dep_conf));
  END IF;

  -- Conflito: itens de folha do mesmo lote com divergência material
  WITH pairs AS (
    SELECT p.id AS pid, s.id AS sid, p.batch_id
    FROM public.payroll_batch_items p
    JOIN public.payroll_batch_items s
      ON s.batch_id = p.batch_id
     AND s.worker_id = _secondary
    WHERE p.worker_id = _primary
      AND p.deleted_at IS NULL AND s.deleted_at IS NULL
      AND NOT (
            p.employment_link_id IS NOT DISTINCT FROM s.employment_link_id
        AND p.base_amount IS NOT DISTINCT FROM s.base_amount
        AND p.overtime_amount IS NOT DISTINCT FROM s.overtime_amount
        AND p.deductions IS NOT DISTINCT FROM s.deductions
        AND p.bonuses IS NOT DISTINCT FROM s.bonuses
        AND p.net_amount IS NOT DISTINCT FROM s.net_amount
        AND p.status IS NOT DISTINCT FROM s.status
      )
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'primary_item_id', pid, 'secondary_item_id', sid, 'batch_id', batch_id
  )), '[]'::jsonb) INTO v_pay_conf FROM pairs;

  IF jsonb_array_length(v_pay_conf) > 0 THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code','MERGE_CONFLICT_PAYROLL_ITEMS','records', v_pay_conf));
  END IF;

  -- Conflito: linked_profile_id distintos
  IF v_primary.linked_profile_id IS NOT NULL
     AND v_secondary.linked_profile_id IS NOT NULL
     AND v_primary.linked_profile_id <> v_secondary.linked_profile_id THEN
    v_prof_conf := jsonb_build_array(jsonb_build_object(
      'primary_profile_id', v_primary.linked_profile_id,
      'secondary_profile_id', v_secondary.linked_profile_id));
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code','MERGE_CONFLICT_LINKED_PROFILE','records', v_prof_conf));
  END IF;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    VALUES ('workers', _secondary, 'merge_conflict',
      jsonb_build_object('primary', _primary, 'secondary', _secondary),
      jsonb_build_object('conflicts', v_conflicts),
      v_uid);
    RETURN jsonb_build_object('result','conflict','conflicts', v_conflicts);
  END IF;

  -- =============== TRANSFERÊNCIA ===============

  -- employment_links
  UPDATE public.employment_links SET worker_id = _primary
    WHERE worker_id = _secondary;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('employment_links', v_count);

  -- link_group_workers: colisão => soft-delete no secundário; sem colisão => update
  UPDATE public.link_group_workers s
     SET deleted_at = now(),
         notes = concat_ws(E'\n', s.notes,
           '[MERGE] Alocação secundária consolidada em ' || _primary::text || ' em ' || now()::text)
   WHERE s.worker_id = _secondary
     AND s.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.link_group_workers p
        WHERE p.worker_id = _primary
          AND p.link_group_id = s.link_group_id
          AND p.deleted_at IS NULL
     );

  UPDATE public.link_group_workers
     SET worker_id = _primary
   WHERE worker_id = _secondary
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('link_group_workers_moved', v_count);

  -- employment_link_documents: transferir todos, anexando origem em notes
  UPDATE public.employment_link_documents
     SET worker_id = _primary,
         notes = concat_ws(E'\n', notes, '[MERGE] Originado do trabalhador secundário')
   WHERE worker_id = _secondary;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('employment_link_documents', v_count);

  -- worker_documents: transferir todos (sem deduplicação fraca)
  UPDATE public.worker_documents SET worker_id = _primary
   WHERE worker_id = _secondary;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('worker_documents', v_count);

  -- worker_payment_methods
  -- Se ambos têm preferido, remover preferência do secundário antes de transferir
  IF EXISTS (SELECT 1 FROM public.worker_payment_methods
             WHERE worker_id = _primary AND is_preferred = true AND deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.worker_payment_methods
                 WHERE worker_id = _secondary AND is_preferred = true AND deleted_at IS NULL)
  THEN
    UPDATE public.worker_payment_methods SET is_preferred = false
     WHERE worker_id = _secondary AND is_preferred = true;
  END IF;
  -- Soft-delete de duplicidades fortes (pix_key OU bank_code+agency+account_number)
  UPDATE public.worker_payment_methods s
     SET deleted_at = now(),
         notes = concat_ws(E'\n', s.notes, '[MERGE] Método duplicado consolidado em ' || _primary::text)
   WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.worker_payment_methods p
        WHERE p.worker_id = _primary AND p.deleted_at IS NULL
          AND (
            (p.pix_key IS NOT NULL AND s.pix_key IS NOT NULL AND p.pix_key = s.pix_key)
            OR (coalesce(p.bank_code,'') <> '' AND coalesce(p.agency,'') <> '' AND coalesce(p.account_number,'') <> ''
                AND p.bank_code = s.bank_code AND p.agency = s.agency AND p.account_number = s.account_number)
          )
     );
  UPDATE public.worker_payment_methods SET worker_id = _primary
   WHERE worker_id = _secondary AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('worker_payment_methods_moved', v_count);

  -- worker_dependents: CPF idêntico => soft-delete duplicado; demais => transferir
  UPDATE public.worker_dependents s
     SET deleted_at = now(),
         notes = concat_ws(E'\n', s.notes, '[MERGE] Dependente duplicado (mesmo CPF) consolidado em ' || _primary::text)
   WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
     AND coalesce(regexp_replace(coalesce(s.cpf,''),'\D','','g'),'') <> ''
     AND EXISTS (
       SELECT 1 FROM public.worker_dependents p
        WHERE p.worker_id = _primary AND p.deleted_at IS NULL
          AND regexp_replace(coalesce(p.cpf,''),'\D','','g')
              = regexp_replace(coalesce(s.cpf,''),'\D','','g')
     );
  UPDATE public.worker_dependents SET worker_id = _primary
   WHERE worker_id = _secondary AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('worker_dependents_moved', v_count);

  -- payroll_batch_items: equivalência integral => soft-delete secundário; senão transferir
  UPDATE public.payroll_batch_items s
     SET deleted_at = now(),
         notes = concat_ws(E'\n', s.notes, '[MERGE] Item equivalente consolidado em item do primário')
   WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.payroll_batch_items p
        WHERE p.worker_id = _primary AND p.deleted_at IS NULL
          AND p.batch_id = s.batch_id
          AND p.employment_link_id IS NOT DISTINCT FROM s.employment_link_id
          AND p.base_amount IS NOT DISTINCT FROM s.base_amount
          AND p.overtime_amount IS NOT DISTINCT FROM s.overtime_amount
          AND p.deductions IS NOT DISTINCT FROM s.deductions
          AND p.bonuses IS NOT DISTINCT FROM s.bonuses
          AND p.net_amount IS NOT DISTINCT FROM s.net_amount
          AND p.status IS NOT DISTINCT FROM s.status
     );
  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    SELECT 'payroll_batch_items', s.id, 'merge_payroll_item_consolidated',
           to_jsonb(s), jsonb_build_object('primary', _primary), v_uid
      FROM public.payroll_batch_items s
     WHERE s.worker_id = _secondary AND s.deleted_at IS NOT NULL AND s.updated_at >= now() - interval '1 second';

  UPDATE public.payroll_batch_items SET worker_id = _primary
   WHERE worker_id = _secondary AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_transferred := v_transferred || jsonb_build_object('payroll_batch_items_moved', v_count);

  -- Se apenas o secundário tinha linked_profile_id, promover ao primário
  IF v_primary.linked_profile_id IS NULL AND v_secondary.linked_profile_id IS NOT NULL THEN
    UPDATE public.workers SET linked_profile_id = v_secondary.linked_profile_id WHERE id = _primary;
  END IF;

  -- Finalização do secundário
  UPDATE public.workers
     SET deleted_at = now(),
         merged_into_worker_id = _primary,
         merged_at = now(),
         merged_by = v_uid
   WHERE id = _secondary;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('workers', _secondary, 'merge_workers_success',
    to_jsonb(v_secondary),
    jsonb_build_object('primary', _primary, 'transferred', v_transferred),
    v_uid);

  RETURN jsonb_build_object(
    'result','merged',
    'primaryId', _primary,
    'secondaryId', _secondary,
    'transferred', v_transferred
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_workers(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_workers(uuid, uuid, text) TO authenticated;