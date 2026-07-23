
CREATE OR REPLACE FUNCTION public._q020_apply_allocation_values(
  p_id uuid,
  p_values jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text_keys text[] := ARRAY[
    'job_function','department','contract_type','shift_type','work_shift',
    'work_schedule','remuneration_type','payment_frequency','notes','status'
  ];
  v_numeric_keys text[] := ARRAY[
    'daily_hours','weekly_hours','daily_rate','hourly_rate','fixed_salary',
    'category_reference_rate','transport_allowance','meal_allowance'
  ];
  v_date_keys text[] := ARRAY['hire_date','end_date'];
  v_bool_keys text[] := ARRAY['has_transport_allowance','has_meal_allowance'];
  k text;
BEGIN
  IF p_values IS NULL OR p_values = '{}'::jsonb THEN
    RETURN;
  END IF;

  FOREACH k IN ARRAY v_text_keys LOOP
    IF p_values ? k THEN
      EXECUTE format('UPDATE public.link_group_workers SET %I = $1 WHERE id = $2', k)
        USING NULLIF(p_values->>k,''), p_id;
    END IF;
  END LOOP;

  FOREACH k IN ARRAY v_numeric_keys LOOP
    IF p_values ? k THEN
      EXECUTE format('UPDATE public.link_group_workers SET %I = $1 WHERE id = $2', k)
        USING (NULLIF(p_values->>k,''))::numeric, p_id;
    END IF;
  END LOOP;

  FOREACH k IN ARRAY v_date_keys LOOP
    IF p_values ? k THEN
      EXECUTE format('UPDATE public.link_group_workers SET %I = $1 WHERE id = $2', k)
        USING (NULLIF(p_values->>k,''))::date, p_id;
    END IF;
  END LOOP;

  FOREACH k IN ARRAY v_bool_keys LOOP
    IF p_values ? k THEN
      EXECUTE format('UPDATE public.link_group_workers SET %I = COALESCE($1, false) WHERE id = $2', k)
        USING (p_values->>k)::boolean, p_id;
    END IF;
  END LOOP;

  IF p_values ? 'call_time' THEN
    UPDATE public.link_group_workers
       SET call_time = (NULLIF(p_values->>'call_time',''))::time
     WHERE id = p_id;
  END IF;

  UPDATE public.link_group_workers SET updated_at = now() WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public._q020_apply_allocation_values(uuid, jsonb) FROM PUBLIC, anon;
