
-- ============================================================
-- Q-020.B — Atomic allocation with formal employment link
-- ============================================================

-- Whitelisted allocation fields (from jsonb → columns)
CREATE OR REPLACE FUNCTION public._q020_apply_allocation_values(
  p_id uuid,
  p_values jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_values IS NULL OR p_values = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE public.link_group_workers SET
    job_function = COALESCE(NULLIF(p_values->>'job_function',''), job_function),
    department = COALESCE(NULLIF(p_values->>'department',''), department),
    contract_type = COALESCE(NULLIF(p_values->>'contract_type',''), contract_type),
    shift_type = COALESCE(NULLIF(p_values->>'shift_type',''), shift_type),
    work_shift = COALESCE(NULLIF(p_values->>'work_shift',''), work_shift),
    work_schedule = COALESCE(NULLIF(p_values->>'work_schedule',''), work_schedule),
    call_time = COALESCE(NULLIF(p_values->>'call_time','')::time, call_time),
    daily_hours = COALESCE((p_values->>'daily_hours')::numeric, daily_hours),
    weekly_hours = COALESCE((p_values->>'weekly_hours')::numeric, weekly_hours),
    remuneration_type = COALESCE(NULLIF(p_values->>'remuneration_type',''), remuneration_type),
    daily_rate = COALESCE((p_values->>'daily_rate')::numeric, daily_rate),
    hourly_rate = COALESCE((p_values->>'hourly_rate')::numeric, hourly_rate),
    fixed_salary = COALESCE((p_values->>'fixed_salary')::numeric, fixed_salary),
    category_reference_rate = COALESCE((p_values->>'category_reference_rate')::numeric, category_reference_rate),
    has_transport_allowance = COALESCE((p_values->>'has_transport_allowance')::boolean, has_transport_allowance),
    transport_allowance = COALESCE((p_values->>'transport_allowance')::numeric, transport_allowance),
    has_meal_allowance = COALESCE((p_values->>'has_meal_allowance')::boolean, has_meal_allowance),
    meal_allowance = COALESCE((p_values->>'meal_allowance')::numeric, meal_allowance),
    payment_frequency = COALESCE(NULLIF(p_values->>'payment_frequency',''), payment_frequency),
    notes = COALESCE(NULLIF(p_values->>'notes',''), notes),
    hire_date = COALESCE((NULLIF(p_values->>'hire_date',''))::date, hire_date),
    end_date = COALESCE((NULLIF(p_values->>'end_date',''))::date, end_date),
    status = COALESCE(NULLIF(p_values->>'status',''), status),
    updated_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public._q020_apply_allocation_values(uuid, jsonb) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- f_resolve_or_create_allocation_employment_link
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.f_resolve_or_create_allocation_employment_link(
  p_worker_id uuid,
  p_event_id uuid,
  p_job_role_id uuid,
  p_company_id uuid,
  p_hire_date date,
  p_end_date date,
  p_initial_status text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_link_id uuid;
  v_role_active boolean;
  v_worker_ok boolean;
  v_event_ok boolean;
  v_role_name text;
  v_event_name text;
  v_status text;
  v_actor uuid := auth.uid();
BEGIN
  IF p_worker_id IS NULL OR p_event_id IS NULL OR p_job_role_id IS NULL THEN
    RAISE EXCEPTION 'formal_link_missing_identity';
  END IF;

  SELECT true INTO v_worker_ok FROM public.workers
    WHERE id = p_worker_id AND deleted_at IS NULL;
  IF NOT COALESCE(v_worker_ok, false) THEN
    RAISE EXCEPTION 'formal_link_worker_invalid';
  END IF;

  SELECT name INTO v_event_name FROM public.events
    WHERE id = p_event_id AND deleted_at IS NULL;
  IF v_event_name IS NULL THEN
    RAISE EXCEPTION 'formal_link_event_invalid';
  END IF;

  SELECT name, is_active INTO v_role_name, v_role_active FROM public.job_roles
    WHERE id = p_job_role_id AND deleted_at IS NULL;
  IF v_role_name IS NULL THEN
    RAISE EXCEPTION 'formal_link_role_invalid';
  END IF;
  IF NOT COALESCE(v_role_active, false) THEN
    RAISE EXCEPTION 'formal_link_role_inactive';
  END IF;

  -- Exact match search (worker + event + role)
  SELECT COUNT(*) INTO v_count FROM public.employment_links
    WHERE worker_id = p_worker_id AND event_id = p_event_id
      AND job_role_id = p_job_role_id AND deleted_at IS NULL;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'ambiguous_exact_employment_link';
  END IF;

  IF v_count = 1 THEN
    SELECT id INTO v_link_id FROM public.employment_links
      WHERE worker_id = p_worker_id AND event_id = p_event_id
        AND job_role_id = p_job_role_id AND deleted_at IS NULL;
    RETURN v_link_id;
  END IF;

  -- Create new formal link. Status must respect check constraint.
  v_status := COALESCE(NULLIF(p_initial_status,''), 'active');
  IF v_status NOT IN ('draft','active','suspended','completed','terminated','cancelled') THEN
    v_status := 'active';
  END IF;

  INSERT INTO public.employment_links (
    worker_id, event_id, company_id, job_role_id,
    hire_date, end_date, status, link_name
  ) VALUES (
    p_worker_id, p_event_id, p_company_id, p_job_role_id,
    p_hire_date, p_end_date, v_status,
    v_role_name || ' — ' || v_event_name
  ) RETURNING id INTO v_link_id;

  INSERT INTO public.change_logs (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'employment_links', v_link_id, 'INSERT', NULL,
    jsonb_build_object(
      'reason','q020_atomic_allocation',
      'worker_id', p_worker_id,
      'event_id', p_event_id,
      'job_role_id', p_job_role_id
    ),
    v_actor
  );

  RETURN v_link_id;
END;
$$;

REVOKE ALL ON FUNCTION public.f_resolve_or_create_allocation_employment_link(uuid,uuid,uuid,uuid,date,date,text) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- allocate_worker_to_group RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_worker_to_group(
  p_link_group_id uuid,
  p_worker_id uuid,
  p_job_role_id uuid,
  p_values jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_group record;
  v_link_id uuid;
  v_alloc_id uuid;
  v_status text;
  v_dup int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT (
    public.has_role(v_actor,'admin') OR
    public.has_role(v_actor,'manager') OR
    public.has_role(v_actor,'operator')
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  -- Lock group
  SELECT id, event_id, company_id, hire_date, end_date, status, group_name
    INTO v_group
    FROM public.link_groups WHERE id = p_link_group_id AND deleted_at IS NULL
    FOR UPDATE;
  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;
  IF v_group.event_id IS NULL THEN
    RAISE EXCEPTION 'group_missing_event';
  END IF;

  -- Prevent duplicate active allocation of same worker in same group
  SELECT COUNT(*) INTO v_dup FROM public.link_group_workers
    WHERE link_group_id = p_link_group_id AND worker_id = p_worker_id AND deleted_at IS NULL;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'worker_already_allocated_in_group';
  END IF;

  v_status := COALESCE(NULLIF(p_values->>'status',''), 'active');

  -- Resolve/create formal link
  v_link_id := public.f_resolve_or_create_allocation_employment_link(
    p_worker_id,
    v_group.event_id,
    p_job_role_id,
    v_group.company_id,
    COALESCE((NULLIF(p_values->>'hire_date',''))::date, v_group.hire_date),
    COALESCE((NULLIF(p_values->>'end_date',''))::date, v_group.end_date),
    v_status
  );

  -- Insert allocation with formal link
  INSERT INTO public.link_group_workers (
    link_group_id, worker_id, job_role_id, employment_link_id, status
  ) VALUES (
    p_link_group_id, p_worker_id, p_job_role_id, v_link_id, v_status
  ) RETURNING id INTO v_alloc_id;

  -- Apply remaining whitelisted values
  PERFORM public._q020_apply_allocation_values(v_alloc_id, p_values);

  -- Log
  INSERT INTO public.change_logs (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'link_group_workers', v_alloc_id, 'INSERT', NULL,
    jsonb_build_object(
      'reason','q020_atomic_allocation',
      'worker_id', p_worker_id,
      'link_group_id', p_link_group_id,
      'employment_link_id', v_link_id,
      'job_role_id', p_job_role_id
    ),
    v_actor
  );

  -- Reevaluate compliance
  BEGIN
    PERFORM public.reevaluate_worker_links(p_worker_id, 'manual');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'allocation_id', v_alloc_id,
    'employment_link_id', v_link_id,
    'worker_id', p_worker_id,
    'link_group_id', p_link_group_id,
    'job_role_id', p_job_role_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_worker_to_group(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_worker_to_group(uuid,uuid,uuid,jsonb) TO authenticated;

-- ------------------------------------------------------------
-- update_group_worker_allocation RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_group_worker_allocation(
  p_allocation_id uuid,
  p_values jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_alloc record;
  v_group record;
  v_new_role uuid;
  v_new_link uuid;
  v_others int;
  v_hire_date date;
  v_end_date date;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT (
    public.has_role(v_actor,'admin') OR
    public.has_role(v_actor,'manager') OR
    public.has_role(v_actor,'operator')
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  SELECT * INTO v_alloc FROM public.link_group_workers
    WHERE id = p_allocation_id AND deleted_at IS NULL FOR UPDATE;
  IF v_alloc.id IS NULL THEN
    RAISE EXCEPTION 'allocation_not_found';
  END IF;

  SELECT * INTO v_group FROM public.link_groups
    WHERE id = v_alloc.link_group_id AND deleted_at IS NULL;
  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  v_new_role := COALESCE((NULLIF(p_values->>'job_role_id',''))::uuid, v_alloc.job_role_id);
  v_hire_date := COALESCE((NULLIF(p_values->>'hire_date',''))::date, v_alloc.hire_date, v_group.hire_date);
  v_end_date := COALESCE((NULLIF(p_values->>'end_date',''))::date, v_alloc.end_date, v_group.end_date);
  v_status := COALESCE(NULLIF(p_values->>'status',''), v_alloc.status);

  -- Role change: need to re-resolve formal link
  IF v_new_role IS DISTINCT FROM v_alloc.job_role_id OR v_alloc.employment_link_id IS NULL THEN
    -- Check if the current formal link is shared with other active allocations
    SELECT COUNT(*) INTO v_others FROM public.link_group_workers
      WHERE employment_link_id = v_alloc.employment_link_id
        AND id <> v_alloc.id AND deleted_at IS NULL;

    v_new_link := public.f_resolve_or_create_allocation_employment_link(
      v_alloc.worker_id, v_group.event_id, v_new_role,
      v_group.company_id, v_hire_date, v_end_date, v_status
    );

    -- If not shared and link exists, update the formal link's role too
    IF v_alloc.employment_link_id IS NOT NULL AND v_others = 0
       AND v_new_link = v_alloc.employment_link_id THEN
      -- Same link resolved; just update role if it differs
      UPDATE public.employment_links
         SET job_role_id = v_new_role, updated_at = now()
       WHERE id = v_alloc.employment_link_id AND job_role_id IS DISTINCT FROM v_new_role;
    END IF;

    UPDATE public.link_group_workers
       SET job_role_id = v_new_role,
           employment_link_id = v_new_link,
           updated_at = now()
     WHERE id = p_allocation_id;
  END IF;

  -- Apply remaining values
  PERFORM public._q020_apply_allocation_values(p_allocation_id, p_values - 'job_role_id');

  INSERT INTO public.change_logs (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    'link_group_workers', p_allocation_id, 'UPDATE',
    jsonb_build_object('job_role_id', v_alloc.job_role_id, 'employment_link_id', v_alloc.employment_link_id),
    jsonb_build_object(
      'reason','q020_atomic_update',
      'job_role_id', v_new_role,
      'employment_link_id', COALESCE(v_new_link, v_alloc.employment_link_id)
    ),
    v_actor
  );

  BEGIN
    PERFORM public.reevaluate_worker_links(v_alloc.worker_id, 'manual');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'allocation_id', p_allocation_id,
    'employment_link_id', COALESCE(v_new_link, v_alloc.employment_link_id),
    'job_role_id', v_new_role,
    'worker_id', v_alloc.worker_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_group_worker_allocation(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_group_worker_allocation(uuid,jsonb) TO authenticated;

-- ------------------------------------------------------------
-- Unique index preventing duplicate active allocations
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_link_group_workers_active_worker
  ON public.link_group_workers(link_group_id, worker_id)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- Enforcement trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.f_enforce_allocation_employment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_link record;
  v_group_event uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.employment_link_id IS NULL THEN
      RAISE EXCEPTION 'formal_link_required'
        USING HINT = 'Use allocate_worker_to_group RPC to create allocations atomically.';
    END IF;
  END IF;

  -- Structural change checks (INSERT or updates that touch structural columns)
  IF TG_OP = 'INSERT' OR (
    TG_OP = 'UPDATE' AND (
      NEW.employment_link_id IS DISTINCT FROM OLD.employment_link_id
      OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
      OR NEW.link_group_id IS DISTINCT FROM OLD.link_group_id
      OR NEW.job_role_id IS DISTINCT FROM OLD.job_role_id
    )
  ) THEN
    IF NEW.employment_link_id IS NOT NULL THEN
      SELECT worker_id, event_id, job_role_id, deleted_at
        INTO v_link
        FROM public.employment_links WHERE id = NEW.employment_link_id;
      IF v_link IS NULL OR v_link.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'formal_link_required';
      END IF;
      IF v_link.worker_id IS DISTINCT FROM NEW.worker_id THEN
        RAISE EXCEPTION 'formal_link_worker_mismatch';
      END IF;
      SELECT event_id INTO v_group_event FROM public.link_groups WHERE id = NEW.link_group_id;
      IF v_link.event_id IS DISTINCT FROM v_group_event THEN
        RAISE EXCEPTION 'formal_link_event_mismatch';
      END IF;
      IF v_link.job_role_id IS DISTINCT FROM NEW.job_role_id THEN
        RAISE EXCEPTION 'formal_link_role_mismatch';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_allocation_employment_link ON public.link_group_workers;
CREATE TRIGGER trg_enforce_allocation_employment_link
  BEFORE INSERT OR UPDATE ON public.link_group_workers
  FOR EACH ROW EXECUTE FUNCTION public.f_enforce_allocation_employment_link();
