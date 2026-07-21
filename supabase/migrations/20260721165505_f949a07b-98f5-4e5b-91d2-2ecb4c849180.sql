CREATE OR REPLACE FUNCTION public.enforce_job_role_requirement_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_category text;
  v_name text;
BEGIN
  SELECT category, name INTO v_category, v_name
  FROM public.document_types
  WHERE id = NEW.document_type_id;

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'Tipo de documento inválido para requisito de cargo.'
      USING ERRCODE = '22023';
  END IF;

  IF v_category NOT IN ('sst_nr','sst_aso','training') THEN
    RAISE EXCEPTION
      'Não é permitido exigir "%" como requisito de cargo. Apenas NRs, ASO e cursos/treinamentos podem ser vinculados a um cargo. Documentos pessoais (RG, CPF, CNH, CREA, etc.) pertencem ao trabalhador e não devem ser exigidos pelo cargo.',
      COALESCE(v_name, 'documento')
      USING ERRCODE = '22023',
            HINT = 'Selecione um documento das categorias NR, ASO ou treinamento.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_job_role_requirement_category ON public.job_role_document_requirements;
CREATE TRIGGER trg_enforce_job_role_requirement_category
BEFORE INSERT OR UPDATE ON public.job_role_document_requirements
FOR EACH ROW EXECUTE FUNCTION public.enforce_job_role_requirement_category();