
-- Entrega 8: candidatos de duplicidade e preview do merge (admin-only).

CREATE OR REPLACE FUNCTION public.list_worker_duplicate_candidates()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH active AS (
    SELECT id, full_name, nickname, cpf, cpf_normalized, birth_date, email, created_at
      FROM public.workers WHERE deleted_at IS NULL
  ),
  pairs_cpf AS (
    SELECT a.id AS a_id, b.id AS b_id, 'cpf_match'::text AS reason, 1.0::numeric AS similarity
      FROM active a JOIN active b
        ON a.cpf_normalized = b.cpf_normalized AND a.id < b.id
     WHERE a.cpf_normalized IS NOT NULL AND length(a.cpf_normalized) = 11
  ),
  pairs_name AS (
    SELECT a.id AS a_id, b.id AS b_id, 'name_birth'::text AS reason,
           public.similarity(lower(a.full_name), lower(b.full_name))::numeric AS similarity
      FROM active a JOIN active b ON a.id < b.id
     WHERE a.birth_date IS NOT NULL AND a.birth_date = b.birth_date
       AND public.similarity(lower(a.full_name), lower(b.full_name)) >= 0.75
       AND coalesce(a.cpf_normalized,'') <> coalesce(b.cpf_normalized,'')
  ),
  all_pairs AS (
    SELECT * FROM pairs_cpf
    UNION ALL
    SELECT * FROM pairs_name
  ),
  filtered AS (
    SELECT p.* FROM all_pairs p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.worker_duplicate_reviews r
        WHERE r.decision = 'not_same_person'
          AND ((r.worker_a_id = p.a_id AND r.worker_b_id = p.b_id)
            OR (r.worker_a_id = p.b_id AND r.worker_b_id = p.a_id))
     )
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'a', jsonb_build_object(
               'id', wa.id, 'full_name', wa.full_name, 'nickname', wa.nickname,
               'cpf', wa.cpf, 'birth_date', wa.birth_date, 'email', wa.email,
               'created_at', wa.created_at
             ),
             'b', jsonb_build_object(
               'id', wb.id, 'full_name', wb.full_name, 'nickname', wb.nickname,
               'cpf', wb.cpf, 'birth_date', wb.birth_date, 'email', wb.email,
               'created_at', wb.created_at
             ),
             'reason', f.reason,
             'similarity', f.similarity
           )
           ORDER BY f.similarity DESC, wa.full_name
         ), '[]'::jsonb)
    INTO v_out
    FROM filtered f
    JOIN public.workers wa ON wa.id = f.a_id
    JOIN public.workers wb ON wb.id = f.b_id;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.list_worker_duplicate_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_worker_duplicate_candidates() TO authenticated;

-- ------------------------------------------------------------
-- Preview do merge: nunca escreve, apenas conta e detecta conflitos.
CREATE OR REPLACE FUNCTION public.merge_workers_preview(_primary uuid, _secondary uuid)
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
  v_counts jsonb := jsonb_build_object();
  c_links int; c_lgw int; c_lgw_col int; c_docs int; c_wdocs int;
  c_pay int; c_pay_col int; c_dep int; c_dep_col int; c_items int; c_items_col int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _primary IS NULL OR _secondary IS NULL OR _primary = _secondary THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_primary   FROM public.workers WHERE id = _primary;
  IF NOT FOUND OR v_primary.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'primary_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_secondary FROM public.workers WHERE id = _secondary;
  IF NOT FOUND OR v_secondary.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'secondary_not_found' USING ERRCODE = '22023';
  END IF;

  -- Conflitos (mesma lógica de merge_workers)
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

  WITH pairs AS (
    SELECT p.id AS pid, s.id AS sid, p.batch_id
      FROM public.payroll_batch_items p
      JOIN public.payroll_batch_items s
        ON s.batch_id = p.batch_id AND s.worker_id = _secondary
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

  IF v_primary.linked_profile_id IS NOT NULL
     AND v_secondary.linked_profile_id IS NOT NULL
     AND v_primary.linked_profile_id <> v_secondary.linked_profile_id THEN
    v_prof_conf := jsonb_build_array(jsonb_build_object(
      'primary_profile_id', v_primary.linked_profile_id,
      'secondary_profile_id', v_secondary.linked_profile_id));
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code','MERGE_CONFLICT_LINKED_PROFILE','records', v_prof_conf));
  END IF;

  -- Contagens (o que seria movido/consolidado)
  SELECT count(*) INTO c_links FROM public.employment_links WHERE worker_id = _secondary;
  SELECT count(*) INTO c_lgw FROM public.link_group_workers WHERE worker_id = _secondary AND deleted_at IS NULL;
  SELECT count(*) INTO c_lgw_col FROM public.link_group_workers s
    WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.link_group_workers p
                   WHERE p.worker_id = _primary AND p.link_group_id = s.link_group_id AND p.deleted_at IS NULL);
  SELECT count(*) INTO c_docs FROM public.employment_link_documents WHERE worker_id = _secondary;
  SELECT count(*) INTO c_wdocs FROM public.worker_documents WHERE worker_id = _secondary;
  SELECT count(*) INTO c_pay FROM public.worker_payment_methods WHERE worker_id = _secondary AND deleted_at IS NULL;
  SELECT count(*) INTO c_pay_col FROM public.worker_payment_methods s
    WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.worker_payment_methods p
                   WHERE p.worker_id = _primary AND p.deleted_at IS NULL
                     AND ( (p.pix_key IS NOT NULL AND s.pix_key IS NOT NULL AND p.pix_key = s.pix_key)
                        OR (coalesce(p.bank_code,'') <> '' AND coalesce(p.agency,'') <> '' AND coalesce(p.account_number,'') <> ''
                            AND p.bank_code = s.bank_code AND p.agency = s.agency AND p.account_number = s.account_number)));
  SELECT count(*) INTO c_dep FROM public.worker_dependents WHERE worker_id = _secondary AND deleted_at IS NULL;
  SELECT count(*) INTO c_dep_col FROM public.worker_dependents s
    WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
      AND coalesce(regexp_replace(coalesce(s.cpf,''),'\D','','g'),'') <> ''
      AND EXISTS (SELECT 1 FROM public.worker_dependents p
                   WHERE p.worker_id = _primary AND p.deleted_at IS NULL
                     AND regexp_replace(coalesce(p.cpf,''),'\D','','g')
                       = regexp_replace(coalesce(s.cpf,''),'\D','','g'));
  SELECT count(*) INTO c_items FROM public.payroll_batch_items WHERE worker_id = _secondary AND deleted_at IS NULL;
  SELECT count(*) INTO c_items_col FROM public.payroll_batch_items s
    WHERE s.worker_id = _secondary AND s.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.payroll_batch_items p
                   WHERE p.worker_id = _primary AND p.deleted_at IS NULL
                     AND p.batch_id = s.batch_id
                     AND p.employment_link_id IS NOT DISTINCT FROM s.employment_link_id
                     AND p.base_amount IS NOT DISTINCT FROM s.base_amount
                     AND p.overtime_amount IS NOT DISTINCT FROM s.overtime_amount
                     AND p.deductions IS NOT DISTINCT FROM s.deductions
                     AND p.bonuses IS NOT DISTINCT FROM s.bonuses
                     AND p.net_amount IS NOT DISTINCT FROM s.net_amount
                     AND p.status IS NOT DISTINCT FROM s.status);

  v_counts := jsonb_build_object(
    'employment_links', c_links,
    'link_group_workers_total', c_lgw,
    'link_group_workers_collisions', c_lgw_col,
    'employment_link_documents', c_docs,
    'worker_documents', c_wdocs,
    'worker_payment_methods_total', c_pay,
    'worker_payment_methods_collisions', c_pay_col,
    'worker_dependents_total', c_dep,
    'worker_dependents_collisions', c_dep_col,
    'payroll_batch_items_total', c_items,
    'payroll_batch_items_collisions', c_items_col
  );

  RETURN jsonb_build_object(
    'result', CASE WHEN jsonb_array_length(v_conflicts) > 0 THEN 'conflict' ELSE 'ready' END,
    'primary', jsonb_build_object('id', v_primary.id, 'full_name', v_primary.full_name, 'cpf', v_primary.cpf,
                                  'birth_date', v_primary.birth_date, 'email', v_primary.email,
                                  'created_at', v_primary.created_at),
    'secondary', jsonb_build_object('id', v_secondary.id, 'full_name', v_secondary.full_name, 'cpf', v_secondary.cpf,
                                    'birth_date', v_secondary.birth_date, 'email', v_secondary.email,
                                    'created_at', v_secondary.created_at),
    'conflicts', v_conflicts,
    'counts', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_workers_preview(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_workers_preview(uuid, uuid) TO authenticated;
