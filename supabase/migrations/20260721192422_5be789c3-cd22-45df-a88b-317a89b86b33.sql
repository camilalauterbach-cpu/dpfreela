-- =========================================================================
-- E-DOC.2 · Passo 1 — Gate administrativo de escopo do documento
-- =========================================================================
-- Estratégia:
--   1. Adiciona storage_scope (NULLABLE) em document_types.
--   2. Cria tabela de gate com todos os tipos existentes + sugestão.
--   3. Nenhuma trigger de enforcement neste passo (só no Passo 2).
--   4. RPC admin para resolver o gate linha a linha.
-- =========================================================================

-- 1) Enum ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_storage_scope') THEN
    CREATE TYPE public.document_storage_scope AS ENUM ('worker', 'employment_link');
  END IF;
END $$;

-- 2) Coluna em document_types (NULLABLE por enquanto) ---------------------
ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS storage_scope public.document_storage_scope;

COMMENT ON COLUMN public.document_types.storage_scope IS
  'E-DOC.2: worker = documento pertence ao trabalhador (ex.: ASO, CNH, NR35). '
  'employment_link = nasce no vínculo (ex.: APR, PT, checklist). '
  'Após entrada em produção só pode ser alterado via RPC admin dedicada.';

-- 3) Tabela de gate --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_type_scope_backfill_unmatched (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_id UUID NOT NULL UNIQUE REFERENCES public.document_types(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  suggested_scope public.document_storage_scope NOT NULL,
  suggestion_reason TEXT NOT NULL,
  resolved_scope public.document_storage_scope,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_type_scope_backfill_unmatched TO authenticated;
GRANT ALL ON public.document_type_scope_backfill_unmatched TO service_role;

ALTER TABLE public.document_type_scope_backfill_unmatched ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scope gate"
  ON public.document_type_scope_backfill_unmatched
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger updated_at (reaproveita a função global do projeto)
DROP TRIGGER IF EXISTS trg_doc_scope_gate_updated_at ON public.document_type_scope_backfill_unmatched;
CREATE TRIGGER trg_doc_scope_gate_updated_at
  BEFORE UPDATE ON public.document_type_scope_backfill_unmatched
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Popular o gate com todos os tipos existentes -------------------------
--    Sugestão é apenas uma dica. O admin decide caso a caso.
INSERT INTO public.document_type_scope_backfill_unmatched
  (document_type_id, code, name, category, suggested_scope, suggestion_reason)
SELECT
  dt.id,
  dt.code,
  dt.name,
  dt.category,
  CASE
    WHEN dt.category IN ('sst_nr','sst_aso') THEN 'worker'::public.document_storage_scope
    WHEN dt.category IN ('personal','professional','license') THEN 'worker'::public.document_storage_scope
    WHEN dt.category = 'training' THEN 'worker'::public.document_storage_scope
    ELSE 'employment_link'::public.document_storage_scope
  END,
  CASE
    WHEN dt.category IN ('sst_nr','sst_aso') THEN 'SST/ASO: certificação segue o trabalhador entre projetos.'
    WHEN dt.category = 'personal' THEN 'Documento pessoal: pertence ao trabalhador.'
    WHEN dt.category = 'professional' THEN 'Registro profissional: pertence ao trabalhador.'
    WHEN dt.category = 'license' THEN 'Habilitação/licença: pertence ao trabalhador.'
    WHEN dt.category = 'training' THEN 'Treinamento genérico é do trabalhador; revisar se for específico do evento.'
    WHEN dt.category = 'other' THEN 'Categoria genérica: revisar manualmente.'
    ELSE 'Sugestão padrão — revisar manualmente.'
  END
FROM public.document_types dt
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_type_scope_backfill_unmatched g
  WHERE g.document_type_id = dt.id
);

-- 5) RPC admin: resolver um item do gate ----------------------------------
CREATE OR REPLACE FUNCTION public.resolve_document_type_scope(
  p_document_type_id UUID,
  p_scope public.document_storage_scope,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden: apenas administradores podem resolver o gate de escopo';
  END IF;

  UPDATE public.document_types
     SET storage_scope = p_scope,
         updated_at = now()
   WHERE id = p_document_type_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_type % não encontrado', p_document_type_id;
  END IF;

  UPDATE public.document_type_scope_backfill_unmatched
     SET resolved_scope = p_scope,
         resolved_by = v_uid,
         resolved_at = now(),
         notes = COALESCE(p_notes, notes),
         updated_at = now()
   WHERE document_type_id = p_document_type_id;

  RETURN jsonb_build_object(
    'document_type_id', p_document_type_id,
    'storage_scope', p_scope,
    'resolved_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_document_type_scope(UUID, public.document_storage_scope, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_document_type_scope(UUID, public.document_storage_scope, TEXT) TO authenticated;

-- 6) RPC de status do gate (checagem para o Passo 2) ----------------------
CREATE OR REPLACE FUNCTION public.document_type_scope_gate_status()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'resolved', COUNT(*) FILTER (WHERE resolved_scope IS NOT NULL),
    'pending', COUNT(*) FILTER (WHERE resolved_scope IS NULL),
    'ready_for_step_2', COUNT(*) FILTER (WHERE resolved_scope IS NULL) = 0
  )
  FROM public.document_type_scope_backfill_unmatched;
$$;

REVOKE ALL ON FUNCTION public.document_type_scope_gate_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_type_scope_gate_status() TO authenticated;
