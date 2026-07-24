
-- Q-024.A — Canonical single source of worker qualification types.
-- STABLE + SECURITY DEFINER; enforces auth.uid() and role gate.

CREATE OR REPLACE FUNCTION public.list_worker_qualification_types(
  p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
  document_type_id uuid,
  code text,
  normalized_code text,
  name text,
  category text,
  is_active boolean,
  storage_scope text,
  storage_flow text,
  display_order integer,
  has_expiration boolean,
  default_validity_days integer,
  validity_mode text,
  validity_value integer,
  validity_unit text,
  selectable boolean,
  search_text text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(
    auth.uid(),
    ARRAY['admin','manager','operator','viewer']::app_role[]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH elig AS (
    SELECT
      dt.id,
      dt.code,
      dt.name,
      dt.category::text AS category,
      dt.is_active,
      dt.storage_scope::text AS storage_scope,
      dt.display_order,
      dt.has_expiration,
      dt.default_validity_days,
      dt.validity_mode::text AS validity_mode,
      dt.validity_value,
      dt.validity_unit::text AS validity_unit,
      -- Normalized code: strip accents, lowercase, drop spaces/hyphens/underscores
      regexp_replace(
        public.unaccent(lower(coalesce(dt.code, ''))),
        '[\s\-_]+', '', 'g'
      ) AS normalized_code,
      -- Storage flow derived from category (audited Q-024.A):
      --   sst_nr / training   -> worker_sst_qualifications
      --   sst_aso             -> worker_documents (legacy ASO path)
      CASE
        WHEN dt.category IN ('sst_nr','training') THEN 'worker_sst_qualifications'
        WHEN dt.category = 'sst_aso' THEN 'worker_documents'
        ELSE 'unresolved'
      END AS storage_flow
    FROM public.document_types dt
    WHERE dt.category IN ('sst_nr','sst_aso','training')
      -- Exclude types explicitly scoped to employment_link (never worker-owned)
      AND (dt.storage_scope IS NULL OR dt.storage_scope::text = 'worker')
      AND (p_include_inactive OR dt.is_active)
  )
  SELECT
    e.id AS document_type_id,
    e.code,
    e.normalized_code,
    e.name,
    e.category,
    e.is_active,
    e.storage_scope,
    e.storage_flow,
    e.display_order,
    e.has_expiration,
    e.default_validity_days,
    e.validity_mode,
    e.validity_value,
    e.validity_unit,
    e.is_active AS selectable,
    -- Search text: accent-insensitive, lowercased, includes code + name + normalized
    lower(public.unaccent(coalesce(e.code, '') || ' ' || coalesce(e.name, '') || ' ' || e.normalized_code))
      AS search_text
  FROM elig e
  ORDER BY
    e.is_active DESC,
    e.category,
    e.display_order NULLS LAST,
    e.code NULLS LAST,
    e.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_worker_qualification_types(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_worker_qualification_types(boolean) TO authenticated;

COMMENT ON FUNCTION public.list_worker_qualification_types(boolean) IS
'Q-024.A — Catálogo canônico ÚNICO de tipos documentais elegíveis como qualificação do trabalhador (NRs, ASO/saúde, treinamentos). Fonte compartilhada entre Configurações→Cargos e ficha do trabalhador. Não filtra por obrigatoriedade, vínculo ou existência de documento. Documentos pessoais ficam fora.';
