-- Q-020.A: employment_link_id column + repair RPC

ALTER TABLE public.link_group_workers
  ADD COLUMN IF NOT EXISTS employment_link_id uuid NULL
  REFERENCES public.employment_links(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_link_group_workers_employment_link_id
  ON public.link_group_workers(employment_link_id);

CREATE OR REPLACE FUNCTION public.repair_worker_group_formal_link(
  p_worker_id uuid,
  p_link_group_id uuid,
  p_expected_allocation_id uuid,
  p_existing_employment_link_id uuid,
  p_reason text,
  p_canonicalize_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total int;
  v_ops int;
  v_tombs int;
  v_op_id uuid;
  v_link RECORD;
  v_alloc RECORD;
  v_canonicalized boolean := false;
  v_rowcount int;
  v_event_id uuid;
  v_target_hire date := DATE '2026-07-27';
  v_target_end  date := DATE '2026-09-25';
  v_target_name text := 'Auxiliar de Pessoal — Rock in Rio 2026';
  v_prev_link jsonb;
  v_prev_alloc jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Lock group
  PERFORM 1 FROM public.link_groups WHERE id = p_link_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found' USING ERRCODE = '40001';
  END IF;

  -- Lock all worker×group allocations
  PERFORM 1 FROM public.link_group_workers
    WHERE worker_id = p_worker_id AND link_group_id = p_link_group_id
    ORDER BY created_at, id FOR UPDATE;

  -- Lock existing employment_link
  SELECT * INTO v_link FROM public.employment_links
    WHERE id = p_existing_employment_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'employment_link_missing' USING ERRCODE = '40001';
  END IF;

  -- Recount baseline
  SELECT COUNT(*) INTO v_total FROM public.link_group_workers
    WHERE worker_id = p_worker_id AND link_group_id = p_link_group_id;
  SELECT COUNT(*) INTO v_ops FROM public.link_group_workers
    WHERE worker_id = p_worker_id AND link_group_id = p_link_group_id
      AND deleted_at IS NULL AND COALESCE(status,'active') = 'active';
  SELECT COUNT(*) INTO v_tombs FROM public.link_group_workers
    WHERE worker_id = p_worker_id AND link_group_id = p_link_group_id
      AND deleted_at IS NOT NULL;

  IF v_total <> 4 OR v_ops <> 1 OR v_tombs <> 3 THEN
    RAISE EXCEPTION 'allocation_baseline_changed: total=% ops=% tombs=%', v_total, v_ops, v_tombs
      USING ERRCODE = '40001';
  END IF;

  SELECT id INTO v_op_id FROM public.link_group_workers
    WHERE worker_id = p_worker_id AND link_group_id = p_link_group_id
      AND deleted_at IS NULL AND COALESCE(status,'active') = 'active';
  IF v_op_id IS DISTINCT FROM p_expected_allocation_id THEN
    RAISE EXCEPTION 'allocation_baseline_changed: unexpected_operational_id=%', v_op_id
      USING ERRCODE = '40001';
  END IF;

  -- Validate operational allocation content
  SELECT * INTO v_alloc FROM public.link_group_workers WHERE id = v_op_id;
  IF v_alloc.deleted_at IS NOT NULL
     OR v_alloc.status IS DISTINCT FROM 'active'
     OR v_alloc.worker_id IS DISTINCT FROM p_worker_id
     OR v_alloc.link_group_id IS DISTINCT FROM p_link_group_id
     OR v_alloc.job_role_id IS DISTINCT FROM v_link.job_role_id
     OR v_alloc.hire_date IS DISTINCT FROM v_target_hire
     OR v_alloc.end_date IS DISTINCT FROM v_target_end THEN
    RAISE EXCEPTION 'operational_allocation_changed' USING ERRCODE = '40001';
  END IF;

  -- Validate employment link
  IF v_link.deleted_at IS NOT NULL
     OR v_link.worker_id IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'employment_link_invalid' USING ERRCODE = '40001';
  END IF;
  v_event_id := v_link.event_id;

  -- Exactly one link for worker+event+job_role
  SELECT COUNT(*) INTO v_rowcount FROM public.employment_links
    WHERE deleted_at IS NULL AND worker_id = p_worker_id
      AND event_id = v_event_id AND job_role_id = v_link.job_role_id;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'employment_link_uniqueness_violation: %', v_rowcount USING ERRCODE = '40001';
  END IF;

  -- Canonicalize existing link
  IF p_canonicalize_existing THEN
    IF v_link.hire_date IS DISTINCT FROM v_target_hire
       OR v_link.end_date IS DISTINCT FROM v_target_end
       OR v_link.link_name IS DISTINCT FROM v_target_name THEN
      v_prev_link := jsonb_build_object(
        'hire_date', v_link.hire_date,
        'end_date', v_link.end_date,
        'link_name', v_link.link_name
      );
      UPDATE public.employment_links
        SET hire_date = v_target_hire,
            end_date = v_target_end,
            link_name = v_target_name,
            updated_at = now()
        WHERE id = v_link.id;
      v_canonicalized := true;

      INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
      VALUES (
        'employment_links', v_link.id, 'canonicalize_existing_employment_link',
        v_prev_link,
        jsonb_build_object(
          'reason', p_reason,
          'decision', 'human_authorized_q020_amanda_current_allocation',
          'worker_id', p_worker_id,
          'link_group_id', p_link_group_id,
          'allocation_id', v_op_id,
          'employment_link_id', v_link.id,
          'job_role_id', v_link.job_role_id,
          'hire_date', v_target_hire,
          'end_date', v_target_end,
          'link_name', v_target_name,
          'ignored_soft_deleted_allocations', 3
        ),
        v_uid
      );
    END IF;
  END IF;

  -- Associate allocation (idempotent)
  IF v_alloc.employment_link_id IS DISTINCT FROM v_link.id THEN
    v_prev_alloc := jsonb_build_object('employment_link_id', v_alloc.employment_link_id);
    UPDATE public.link_group_workers
      SET employment_link_id = v_link.id
      WHERE id = v_op_id
        AND worker_id = p_worker_id
        AND link_group_id = p_link_group_id
        AND deleted_at IS NULL
        AND COALESCE(status,'active') = 'active';
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount <> 1 THEN
      RAISE EXCEPTION 'associate_rowcount_mismatch: %', v_rowcount USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (
      'link_group_workers', v_op_id, 'associate_allocation_formal_link',
      v_prev_alloc,
      jsonb_build_object(
        'reason', p_reason,
        'decision', 'human_authorized_q020_amanda_current_allocation',
        'worker_id', p_worker_id,
        'link_group_id', p_link_group_id,
        'allocation_id', v_op_id,
        'employment_link_id', v_link.id,
        'job_role_id', v_link.job_role_id,
        'ignored_soft_deleted_allocations', 3
      ),
      v_uid
    );
  END IF;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'allocation_id', v_op_id,
    'employment_link_id', v_link.id,
    'created', false,
    'reused', true,
    'canonicalized', v_canonicalized,
    'associated', true,
    'ignored_soft_deleted_allocations', 3,
    'total_worker_group_rows', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_worker_group_formal_link(uuid,uuid,uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_worker_group_formal_link(uuid,uuid,uuid,uuid,text,boolean) TO authenticated;