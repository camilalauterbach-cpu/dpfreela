
CREATE OR REPLACE FUNCTION public.set_document_type_validity(
  p_document_type_id uuid,
  p_mode text,
  p_value integer DEFAULT NULL,
  p_unit text DEFAULT NULL
)
RETURNS public.document_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode public.document_validity_mode;
  v_unit public.document_validity_unit;
  v_days integer;
  v_row public.document_types;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['admin'::app_role, 'manager'::app_role]) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_document_type_id IS NULL THEN
    RAISE EXCEPTION 'document_type_id_required' USING ERRCODE = '22004';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('no_expiry','fixed_duration') THEN
    RAISE EXCEPTION 'validity_mode_invalid' USING ERRCODE = '22023';
  END IF;

  v_mode := p_mode::public.document_validity_mode;

  IF v_mode = 'no_expiry' THEN
    v_unit := NULL;
    v_days := NULL;
    IF p_value IS NOT NULL OR p_unit IS NOT NULL THEN
      -- coerção limpa: ignorar valores enviados junto com no_expiry
      NULL;
    END IF;
    UPDATE public.document_types
       SET validity_mode = 'no_expiry',
           validity_value = NULL,
           validity_unit = NULL,
           has_expiration = false,
           default_validity_days = NULL,
           updated_at = now()
     WHERE id = p_document_type_id
     RETURNING * INTO v_row;
  ELSE
    -- fixed_duration
    IF p_value IS NULL OR p_value <= 0 THEN
      RAISE EXCEPTION 'validity_value_must_be_positive' USING ERRCODE = '22023';
    END IF;
    IF p_unit IS NULL OR p_unit NOT IN ('day','month','year') THEN
      RAISE EXCEPTION 'validity_unit_invalid' USING ERRCODE = '22023';
    END IF;
    v_unit := p_unit::public.document_validity_unit;
    v_days := CASE v_unit
      WHEN 'day'   THEN p_value
      WHEN 'month' THEN p_value * 30
      WHEN 'year'  THEN p_value * 365
    END;
    UPDATE public.document_types
       SET validity_mode = 'fixed_duration',
           validity_value = p_value,
           validity_unit = v_unit,
           has_expiration = true,
           default_validity_days = v_days,
           updated_at = now()
     WHERE id = p_document_type_id
     RETURNING * INTO v_row;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'document_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_type_validity(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_type_validity(uuid, text, integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_document_type_validity(uuid, text, integer, text) IS
'Configura validade padrão de um tipo de documento. Mantém has_expiration/default_validity_days em sincronia com validity_mode/value/unit para preservar a fonte única. Apenas admin/manager.';
