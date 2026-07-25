
-- 1. Enum + coluna canônica em document_types
DO $$ BEGIN
  CREATE TYPE public.document_completion_requirement AS ENUM ('required','optional');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS completion_requirement public.document_completion_requirement
    NOT NULL DEFAULT 'optional';

CREATE INDEX IF NOT EXISTS idx_document_types_completion_requirement
  ON public.document_types(completion_requirement)
  WHERE is_active = true;

-- Seed inicial: promover a 'required' tipos já marcados como mandatórios no requisito global ativo
UPDATE public.document_types dt
   SET completion_requirement = 'required'
  FROM public.global_document_requirements g
 WHERE g.document_type_id = dt.id
   AND g.is_active = true
   AND g.is_mandatory = true
   AND g.deleted_at IS NULL
   AND dt.completion_requirement <> 'required';

-- 2. Função utilitária: verifica se um documento está "vigente/aceito"
CREATE OR REPLACE FUNCTION public.document_is_valid_for_completion(
  p_status text,
  p_expiry_date date,
  p_deleted_at timestamptz,
  p_is_current boolean,
  p_has_expiration boolean,
  p_validity_mode public.document_validity_mode
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    p_deleted_at IS NULL
    AND (p_is_current IS DISTINCT FROM false)
    AND coalesce(p_status,'uploaded') IN ('approved','uploaded')
    AND (
      -- Sem controle de vencimento: presença basta
      (coalesce(p_validity_mode::text,'no_expiry') = 'no_expiry' AND coalesce(p_has_expiration,false) = false)
      OR
      -- Com vencimento: exige data futura
      (
        (coalesce(p_has_expiration,false) = true OR p_validity_mode IN ('fixed_duration','explicit_date'))
        AND p_expiry_date IS NOT NULL
        AND p_expiry_date >= current_date
      )
    )
$$;

-- 3. Avaliador canônico por trabalhador
CREATE OR REPLACE FUNCTION public.evaluate_worker_registration_completion(p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing jsonb;
  v_status text;
BEGIN
  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  WITH required_types AS (
    SELECT id, code, name, has_expiration, validity_mode
      FROM public.document_types
     WHERE is_active = true
       AND completion_requirement = 'required'
  ),
  best_doc AS (
    SELECT DISTINCT ON (wd.document_type_id)
           wd.document_type_id, wd.status, wd.expiry_date, wd.deleted_at, wd.is_current
      FROM public.worker_documents wd
     WHERE wd.worker_id = p_worker_id
       AND wd.deleted_at IS NULL
       AND wd.document_type_id IS NOT NULL
     ORDER BY wd.document_type_id,
              (wd.is_current IS TRUE) DESC,
              coalesce(wd.expiry_date, '1900-01-01'::date) DESC,
              wd.created_at DESC
  ),
  eval AS (
    SELECT rt.id, rt.code, rt.name,
           bd.status, bd.expiry_date,
           public.document_is_valid_for_completion(
             bd.status, bd.expiry_date, bd.deleted_at, bd.is_current,
             rt.has_expiration, rt.validity_mode
           ) AS ok,
           CASE
             WHEN bd.document_type_id IS NULL THEN 'ausente'
             WHEN coalesce(bd.status,'') = 'rejected' THEN 'rejeitado'
             WHEN (rt.has_expiration OR rt.validity_mode IN ('fixed_duration','explicit_date'))
                  AND (bd.expiry_date IS NULL OR bd.expiry_date < current_date) THEN 'vencido'
             ELSE NULL
           END AS reason
      FROM required_types rt
      LEFT JOIN best_doc bd ON bd.document_type_id = rt.id
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'document_type_id', id,
             'code', code,
             'name', name,
             'reason', coalesce(reason,'ausente')
           ) ORDER BY name
         ) FILTER (WHERE ok IS DISTINCT FROM true), '[]'::jsonb)
    INTO v_missing
    FROM eval;

  v_status := CASE WHEN jsonb_array_length(v_missing) = 0 THEN 'complete' ELSE 'incomplete' END;

  UPDATE public.workers
     SET registration_status = v_status,
         updated_at = now()
   WHERE id = p_worker_id
     AND registration_status IS DISTINCT FROM v_status;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'status', v_status,
    'missing', v_missing,
    'evaluated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_worker_registration_completion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.evaluate_worker_registration_completion(uuid) TO authenticated, service_role;

-- 4. Recompute em massa (backfill / após mudança de configuração)
CREATE OR REPLACE FUNCTION public.recompute_all_workers_registration_status()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.workers WHERE deleted_at IS NULL LOOP
    PERFORM public.evaluate_worker_registration_completion(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_all_workers_registration_status() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_all_workers_registration_status() TO service_role;

-- 5. RPC administrativa para alternar obrigatório/opcional
CREATE OR REPLACE FUNCTION public.set_document_type_completion_requirement(
  p_document_type_id uuid,
  p_requirement text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new public.document_completion_requirement;
  v_old public.document_completion_requirement;
  v_affected integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_requirement NOT IN ('required','optional') THEN
    RAISE EXCEPTION 'requirement_invalid';
  END IF;
  v_new := p_requirement::public.document_completion_requirement;

  SELECT completion_requirement INTO v_old
    FROM public.document_types WHERE id = p_document_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type_not_found';
  END IF;

  IF v_old = v_new THEN
    RETURN jsonb_build_object('status','unchanged','requirement', v_new);
  END IF;

  UPDATE public.document_types
     SET completion_requirement = v_new,
         updated_at = now()
   WHERE id = p_document_type_id;

  -- Recalcula todos os trabalhadores afetados (mudança global)
  v_affected := public.recompute_all_workers_registration_status();

  RETURN jsonb_build_object(
    'status','ok',
    'previous', v_old,
    'requirement', v_new,
    'workers_recomputed', v_affected
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_type_completion_requirement(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_document_type_completion_requirement(uuid,text) TO authenticated, service_role;

-- 6. Triggers: reavaliar ao mudar documentos
CREATE OR REPLACE FUNCTION public.trg_worker_docs_reeval_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker uuid;
BEGIN
  v_worker := coalesce(NEW.worker_id, OLD.worker_id);
  IF v_worker IS NOT NULL THEN
    PERFORM public.evaluate_worker_registration_completion(v_worker);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_worker_docs_reeval_completion ON public.worker_documents;
CREATE TRIGGER trg_worker_docs_reeval_completion
AFTER INSERT OR UPDATE OR DELETE ON public.worker_documents
FOR EACH ROW EXECUTE FUNCTION public.trg_worker_docs_reeval_completion();

-- 7. Trigger em document_types: mudança de is_active / completion_requirement recalcula tudo
CREATE OR REPLACE FUNCTION public.trg_doc_types_reeval_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE') AND (
      NEW.completion_requirement IS DISTINCT FROM OLD.completion_requirement
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
  ) THEN
    PERFORM public.recompute_all_workers_registration_status();
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_doc_types_reeval_completion ON public.document_types;
CREATE TRIGGER trg_doc_types_reeval_completion
AFTER UPDATE ON public.document_types
FOR EACH ROW EXECUTE FUNCTION public.trg_doc_types_reeval_completion();

-- 8. Guard: bloquear vínculo/alocação ativa se cadastro incompleto
CREATE OR REPLACE FUNCTION public.assert_worker_registration_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_worker uuid := NEW.worker_id;
  v_becoming_active boolean;
BEGIN
  v_becoming_active := coalesce(NEW.status,'') = 'active'
    AND (TG_OP = 'INSERT' OR coalesce(OLD.status,'') <> 'active');

  IF NOT v_becoming_active THEN
    RETURN NEW;
  END IF;

  -- Reavalia sob demanda para garantir o valor mais recente
  PERFORM public.evaluate_worker_registration_completion(v_worker);
  SELECT registration_status INTO v_status FROM public.workers WHERE id = v_worker;

  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'worker_registration_incomplete'
      USING HINT = 'Documentos obrigatórios pendentes impedem a ativação do vínculo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_completion_employment_links ON public.employment_links;
CREATE TRIGGER trg_assert_completion_employment_links
BEFORE INSERT OR UPDATE OF status ON public.employment_links
FOR EACH ROW EXECUTE FUNCTION public.assert_worker_registration_complete();

DROP TRIGGER IF EXISTS trg_assert_completion_link_group_workers ON public.link_group_workers;
CREATE TRIGGER trg_assert_completion_link_group_workers
BEFORE INSERT OR UPDATE OF status ON public.link_group_workers
FOR EACH ROW EXECUTE FUNCTION public.assert_worker_registration_complete();

-- 9. Backfill imediato dos 118 trabalhadores
SELECT public.recompute_all_workers_registration_status();
