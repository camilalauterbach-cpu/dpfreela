
-- 1) Tipo canônico RG
INSERT INTO public.document_types
  (code, name, category, has_expiration, requires_file, is_active,
   storage_scope, validity_mode, completion_requirement, display_order, notes)
VALUES
  ('rg', 'RG', 'personal', false, true, true,
   'worker', 'no_expiry', 'required', 10,
   'Documento de identidade. Aceita um ou mais arquivos no mesmo registro (ex.: frente e verso). Sem vencimento.')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  has_expiration = false,
  requires_file = true,
  is_active = true,
  storage_scope = 'worker',
  validity_mode = 'no_expiry',
  validity_value = NULL,
  validity_unit = NULL,
  completion_requirement = 'required',
  notes = EXCLUDED.notes,
  updated_at = now();

-- 2) Registro Profissional canônico (metadados; não força obrigatório)
UPDATE public.document_types
   SET is_active = true,
       storage_scope = coalesce(storage_scope, 'worker'::document_storage_scope),
       notes = coalesce(notes || E'\n', '') ||
               'Tipo canônico único para documentos profissionais. Consolida Carteira Profissional e CREA.',
       updated_at = now()
 WHERE code = 'registro_prof';

-- 3) Vacinação opcional e sem vencimento
UPDATE public.document_types
   SET completion_requirement = 'optional',
       validity_mode = 'no_expiry',
       validity_value = NULL,
       validity_unit = NULL,
       has_expiration = false,
       is_active = true,
       updated_at = now()
 WHERE code = 'vacinacao';

-- 4) Tabela de múltiplos arquivos por documento
CREATE TABLE IF NOT EXISTS public.worker_document_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_document_id uuid NOT NULL REFERENCES public.worker_documents(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text,
  file_size bigint,
  mime_type text,
  position integer NOT NULL DEFAULT 0,
  origin text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_wdf_doc_active
  ON public.worker_document_files(worker_document_id)
  WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_document_files TO authenticated;
GRANT ALL ON public.worker_document_files TO service_role;

ALTER TABLE public.worker_document_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_worker_document_files"
  ON public.worker_document_files FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(),
      ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role,'viewer'::app_role])
    AND deleted_at IS NULL
  );

CREATE POLICY "soft_deleted_select_worker_document_files"
  ON public.worker_document_files FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(),
      ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role])
    AND deleted_at IS NOT NULL
  );

CREATE POLICY "insert_worker_document_files"
  ON public.worker_document_files FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(),
      ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role])
  );

CREATE POLICY "update_worker_document_files"
  ON public.worker_document_files FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(),
      ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role])
  )
  WITH CHECK (
    public.has_any_role(auth.uid(),
      ARRAY['admin'::app_role,'manager'::app_role,'operator'::app_role])
  );

CREATE POLICY "delete_worker_document_files"
  ON public.worker_document_files FOR DELETE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE TRIGGER update_worker_document_files_updated_at
  BEFORE UPDATE ON public.worker_document_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Consolidação de RG frente/verso -> RG canônico + anexos
DO $$
DECLARE
  v_rg          uuid;
  v_rg_front   uuid := 'deb524e9-5492-42b0-b34a-9d29d94194b4'::uuid;
  v_rg_back    uuid := '7b6079c6-c492-473d-9d8c-0eb9dd43ab1b'::uuid;
  v_worker     uuid;
  v_canonical  uuid;
  v_pos        int;
  outer_rec    RECORD;
  inner_rec    RECORD;
BEGIN
  SELECT id INTO v_rg FROM public.document_types WHERE code = 'rg';

  FOR outer_rec IN
    SELECT DISTINCT worker_id
      FROM public.worker_documents
     WHERE deleted_at IS NULL
       AND (
         category IN ('rg_front','rg_back')
         OR document_type_id IN (v_rg_front, v_rg_back)
       )
  LOOP
    v_worker := outer_rec.worker_id;

    -- Escolha determinística: is_current > rg_front > mais recente
    SELECT id INTO v_canonical
      FROM public.worker_documents
     WHERE worker_id = v_worker
       AND deleted_at IS NULL
       AND (
         category IN ('rg_front','rg_back')
         OR document_type_id IN (v_rg_front, v_rg_back)
       )
     ORDER BY (is_current) DESC NULLS LAST,
              (category = 'rg_front') DESC NULLS LAST,
              updated_at DESC
     LIMIT 1;

    -- Reassocia o canônico ao tipo RG
    UPDATE public.worker_documents
       SET document_type_id = v_rg,
           category = 'rg',
           document_type = 'rg',
           expiry_date = NULL,  -- RG é sem vencimento
           updated_at = now(),
           notes = coalesce(notes || E'\n', '') ||
                   'Consolidação: registro promovido ao tipo canônico RG (' || v_rg::text || ').'
     WHERE id = v_canonical;

    -- Anexo primário
    INSERT INTO public.worker_document_files
      (worker_document_id, file_path, file_name, file_size, mime_type, position, origin)
    SELECT id, file_path, file_name, file_size, mime_type, 1, 'primary'
      FROM public.worker_documents
     WHERE id = v_canonical AND file_path IS NOT NULL;

    v_pos := 1;

    -- Demais registros ativos de RG viram anexos e são soft-deletados preservando dados
    FOR inner_rec IN
      SELECT id, file_path, file_name, file_size, mime_type, category, document_type_id
        FROM public.worker_documents
       WHERE worker_id = v_worker
         AND deleted_at IS NULL
         AND id <> v_canonical
         AND (
           category IN ('rg_front','rg_back')
           OR document_type_id IN (v_rg_front, v_rg_back)
         )
    LOOP
      v_pos := v_pos + 1;
      IF inner_rec.file_path IS NOT NULL THEN
        INSERT INTO public.worker_document_files
          (worker_document_id, file_path, file_name, file_size, mime_type, position, origin, notes)
        VALUES (
          v_canonical,
          inner_rec.file_path, inner_rec.file_name, inner_rec.file_size, inner_rec.mime_type,
          v_pos,
          coalesce(inner_rec.category, 'rg_legacy'),
          'Anexo migrado do registro legado ' || inner_rec.id::text
        );
      END IF;
      UPDATE public.worker_documents
         SET deleted_at = now(),
             updated_at = now(),
             notes = coalesce(notes || E'\n', '') ||
                     'Consolidado no RG canônico ' || v_canonical::text || '.'
       WHERE id = inner_rec.id;
    END LOOP;
  END LOOP;
END $$;

-- 6) Desativa tipos duplicados e neutraliza obrigatoriedade (não altera histórico)
UPDATE public.document_types
   SET is_active = false,
       completion_requirement = 'optional',
       updated_at = now(),
       notes = coalesce(notes || E'\n', '') ||
               'Desativado: consolidado em RG (código rg).'
 WHERE code IN ('rg_front','rg_back');

UPDATE public.document_types
   SET is_active = false,
       completion_requirement = 'optional',
       updated_at = now(),
       notes = coalesce(notes || E'\n', '') ||
               'Desativado: consolidado em Registro Profissional (código registro_prof).'
 WHERE code IN ('carteira_prof','crea');

-- 7) Recalcula completude de todos os trabalhadores
DO $$
DECLARE w uuid;
BEGIN
  FOR w IN SELECT id FROM public.workers WHERE deleted_at IS NULL LOOP
    PERFORM public.evaluate_worker_registration_completion(w);
  END LOOP;
END $$;
