
-- =========================================================
-- Entrega 12 — Documentos por Cargo (schema + seed + backfill)
-- =========================================================

-- 1. document_types --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  has_expiration boolean NOT NULL DEFAULT false,
  default_validity_days integer,
  requires_file boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  needs_review boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT document_types_code_key UNIQUE (code),
  CONSTRAINT document_types_category_check CHECK (category IN
    ('sst_nr','sst_aso','personal','professional','training','license','other'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_types TO authenticated;
GRANT ALL ON public.document_types TO service_role;
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_document_types" ON public.document_types;
CREATE POLICY "select_document_types" ON public.document_types
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]));

DROP POLICY IF EXISTS "insert_document_types" ON public.document_types;
CREATE POLICY "insert_document_types" ON public.document_types
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP POLICY IF EXISTS "update_document_types" ON public.document_types;
CREATE POLICY "update_document_types" ON public.document_types
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP POLICY IF EXISTS "delete_document_types" ON public.document_types;
CREATE POLICY "delete_document_types" ON public.document_types
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_document_types_updated_at ON public.document_types;
CREATE TRIGGER trg_document_types_updated_at
  BEFORE UPDATE ON public.document_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_document_types_active
  ON public.document_types(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_document_types_category
  ON public.document_types(category);

-- 2. job_roles -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT job_roles_code_key UNIQUE (code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_roles TO authenticated;
GRANT ALL ON public.job_roles TO service_role;
ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_job_roles" ON public.job_roles;
CREATE POLICY "select_job_roles" ON public.job_roles
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]));

DROP POLICY IF EXISTS "insert_job_roles" ON public.job_roles;
CREATE POLICY "insert_job_roles" ON public.job_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP POLICY IF EXISTS "update_job_roles" ON public.job_roles;
CREATE POLICY "update_job_roles" ON public.job_roles
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP POLICY IF EXISTS "delete_job_roles" ON public.job_roles;
CREATE POLICY "delete_job_roles" ON public.job_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_job_roles_updated_at ON public.job_roles;
CREATE TRIGGER trg_job_roles_updated_at
  BEFORE UPDATE ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_job_roles_active
  ON public.job_roles(is_active) WHERE is_active = true;

-- 3. job_role_document_requirements ---------------------------------
CREATE TABLE IF NOT EXISTS public.job_role_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_role_id uuid NOT NULL REFERENCES public.job_roles(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.document_types(id) ON DELETE RESTRICT,
  is_mandatory boolean NOT NULL DEFAULT true,
  validity_days_override integer,
  display_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT job_role_document_requirements_unique
    UNIQUE (job_role_id, document_type_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_role_document_requirements TO authenticated;
GRANT ALL ON public.job_role_document_requirements TO service_role;
ALTER TABLE public.job_role_document_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_job_role_docs" ON public.job_role_document_requirements;
CREATE POLICY "select_job_role_docs" ON public.job_role_document_requirements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','operator','viewer']::app_role[]));

DROP POLICY IF EXISTS "insert_job_role_docs" ON public.job_role_document_requirements;
CREATE POLICY "insert_job_role_docs" ON public.job_role_document_requirements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP POLICY IF EXISTS "update_job_role_docs" ON public.job_role_document_requirements;
CREATE POLICY "update_job_role_docs" ON public.job_role_document_requirements
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP POLICY IF EXISTS "delete_job_role_docs" ON public.job_role_document_requirements;
CREATE POLICY "delete_job_role_docs" ON public.job_role_document_requirements
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

DROP TRIGGER IF EXISTS trg_job_role_docs_updated_at ON public.job_role_document_requirements;
CREATE TRIGGER trg_job_role_docs_updated_at
  BEFORE UPDATE ON public.job_role_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_jrdr_job_role
  ON public.job_role_document_requirements(job_role_id);
CREATE INDEX IF NOT EXISTS idx_jrdr_document_type
  ON public.job_role_document_requirements(document_type_id);

-- 4. Extensões nas tabelas existentes -------------------------------
ALTER TABLE public.employment_links
  ADD COLUMN IF NOT EXISTS job_role_id uuid REFERENCES public.job_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employment_links_job_role_id
  ON public.employment_links(job_role_id);

ALTER TABLE public.worker_documents
  ADD COLUMN IF NOT EXISTS document_type_id uuid REFERENCES public.document_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_worker_documents_type_id
  ON public.worker_documents(document_type_id);

-- 5. Trigger de auditoria genérico ----------------------------------
CREATE OR REPLACE FUNCTION public.audit_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_rec_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := TG_ARGV[0] || '_created';
    v_rec_id := (row_to_json(NEW)->>'id')::uuid;
    INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_rec_id, v_action, NULL, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := TG_ARGV[0] || '_updated';
    v_rec_id := (row_to_json(NEW)->>'id')::uuid;
    INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_rec_id, v_action, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := TG_ARGV[0] || '_deleted';
    v_rec_id := (row_to_json(OLD)->>'id')::uuid;
    INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_rec_id, v_action, to_jsonb(OLD), NULL, auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Permitir novas ações no change_logs
DO $$
BEGIN
  ALTER TABLE public.change_logs DROP CONSTRAINT IF EXISTS change_logs_action_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Não recriamos check restritivo aqui; a coluna aceita textos livres controlados por trigger.

DROP TRIGGER IF EXISTS trg_audit_document_types ON public.document_types;
CREATE TRIGGER trg_audit_document_types
  AFTER INSERT OR UPDATE OR DELETE ON public.document_types
  FOR EACH ROW EXECUTE FUNCTION public.audit_catalog_change('document_type');

DROP TRIGGER IF EXISTS trg_audit_job_roles ON public.job_roles;
CREATE TRIGGER trg_audit_job_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_catalog_change('job_role');

DROP TRIGGER IF EXISTS trg_audit_jrdr ON public.job_role_document_requirements;
CREATE TRIGGER trg_audit_jrdr
  AFTER INSERT OR UPDATE OR DELETE ON public.job_role_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.audit_catalog_change('job_role_requirement');

-- 6. Seed do catálogo ------------------------------------------------
INSERT INTO public.document_types (code, name, category, has_expiration, default_validity_days, requires_file) VALUES
  -- Documentos pessoais
  ('cpf',              'CPF',                          'personal',     false, NULL, true),
  ('rg_front',         'RG — Frente',                  'personal',     false, NULL, true),
  ('rg_back',          'RG — Verso',                   'personal',     false, NULL, true),
  ('proof_of_address', 'Comprovante de residência',    'personal',     true,  90,   true),
  ('photo',            'Foto 3x4',                     'personal',     false, NULL, true),
  ('bank_document',    'Documento bancário',           'personal',     false, NULL, true),
  ('ctps',             'CTPS',                         'personal',     false, NULL, true),
  ('nis_pis_proof',    'Comprovante NIS/PIS/NIT',      'personal',     false, NULL, true),
  ('voter_id',         'Título de eleitor',            'personal',     false, NULL, true),
  ('military_service', 'Reservista',                   'personal',     false, NULL, true),
  -- SST — ASO
  ('ASO',              'ASO — Atestado de Saúde Ocupacional', 'sst_aso', true, 365, true),
  -- SST — NRs
  ('NR01', 'NR 01 — Disposições gerais',                 'sst_nr', true, 730, true),
  ('NR06', 'NR 06 — EPI',                                'sst_nr', true, 730, true),
  ('NR10', 'NR 10 — Segurança em Eletricidade',          'sst_nr', true, 730, true),
  ('NR11', 'NR 11 — Movimentação de materiais',          'sst_nr', true, 365, true),
  ('NR12', 'NR 12 — Máquinas e equipamentos',            'sst_nr', true, 730, true),
  ('NR17', 'NR 17 — Ergonomia',                          'sst_nr', true, 730, true),
  ('NR18', 'NR 18 — Construção civil',                   'sst_nr', true, 365, true),
  ('NR20', 'NR 20 — Líquidos e gases inflamáveis',       'sst_nr', true, 365, true),
  ('NR33', 'NR 33 — Espaços confinados',                 'sst_nr', true, 365, true),
  ('NR35', 'NR 35 — Trabalho em altura',                 'sst_nr', true, 730, true),
  -- Licenças e cursos
  ('CNH',              'CNH',                          'license',      true,  NULL, true),
  ('empilhadeira',     'Curso de Empilhadeira',        'training',     true,  365,  true),
  ('plataforma',       'Curso Plataforma Elevatória',  'training',     true,  365,  true),
  ('integracao',       'Integração do Cliente',        'training',     true,  365,  true),
  ('treinamento_int',  'Treinamento Interno',          'training',     true,  365,  true),
  ('crea',             'CREA',                         'professional', true,  365,  true),
  ('registro_prof',    'Registro Profissional',        'professional', true,  NULL, true),
  ('carteira_prof',    'Carteira Profissional',        'professional', false, NULL, true),
  ('exame_toxico',     'Exame Toxicológico',           'sst_aso',      true,  730,  true),
  ('vacinacao',        'Comprovante de Vacinação',     'personal',     false, NULL, true),
  ('outros',           'Outros documentos',            'other',        false, NULL, false)
ON CONFLICT (code) DO NOTHING;

-- 7. Backfill worker_documents.document_type_id ---------------------
-- Mapeamento direto (category → code)
UPDATE public.worker_documents wd
   SET document_type_id = dt.id
  FROM public.document_types dt
 WHERE wd.document_type_id IS NULL
   AND dt.code = CASE lower(coalesce(wd.category, wd.document_type, ''))
                   WHEN 'cpf' THEN 'cpf'
                   WHEN 'rg_front' THEN 'rg_front'
                   WHEN 'rg_back' THEN 'rg_back'
                   WHEN 'proof_of_address' THEN 'proof_of_address'
                   WHEN 'photo' THEN 'photo'
                   WHEN 'bank_document' THEN 'bank_document'
                   WHEN 'ctps' THEN 'ctps'
                   WHEN 'nis_pis_proof' THEN 'nis_pis_proof'
                   WHEN 'voter_id' THEN 'voter_id'
                   WHEN 'military_service' THEN 'military_service'
                   WHEN 'cnh' THEN 'CNH'
                   WHEN 'aso' THEN 'ASO'
                   WHEN 'outros' THEN 'outros'
                   ELSE NULL
                 END;

-- Documentos remanescentes (categoria não reconhecida) recebem tipo automático marcado para revisão
DO $$
DECLARE
  v_review_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.worker_documents WHERE document_type_id IS NULL AND deleted_at IS NULL) THEN
    INSERT INTO public.document_types(code, name, category, needs_review, requires_file, notes)
    VALUES ('needs_review', 'Documentos importados — revisar', 'other', true, false,
            'Categoria original não mapeada. Ajustar em Configurações → Catálogo de Documentos.')
    ON CONFLICT (code) DO UPDATE SET needs_review = true
    RETURNING id INTO v_review_id;

    UPDATE public.worker_documents
       SET document_type_id = v_review_id
     WHERE document_type_id IS NULL;
  END IF;
END $$;

-- 8. Backfill job_roles a partir de employment_links.job_role ------
WITH src AS (
  SELECT DISTINCT
    btrim(job_role) AS name,
    lower(btrim(job_role)) AS name_norm
  FROM public.employment_links
  WHERE job_role IS NOT NULL AND btrim(job_role) <> ''
),
dedup AS (
  -- Um representante por nome normalizado (preferir a versão com maiúsculas mistas)
  SELECT DISTINCT ON (name_norm)
    name, name_norm
  FROM src
  ORDER BY name_norm,
           (CASE WHEN name = initcap(name) THEN 0 ELSE 1 END),
           name
)
INSERT INTO public.job_roles(code, name)
SELECT
  regexp_replace(lower(name_norm), '[^a-z0-9]+', '_', 'g') AS code,
  name
FROM dedup
ON CONFLICT (code) DO NOTHING;

-- Preencher employment_links.job_role_id
UPDATE public.employment_links el
   SET job_role_id = jr.id
  FROM public.job_roles jr
 WHERE el.job_role_id IS NULL
   AND el.job_role IS NOT NULL
   AND jr.code = regexp_replace(lower(btrim(el.job_role)), '[^a-z0-9]+', '_', 'g');

-- 9. Comentários (deprecations) -------------------------------------
COMMENT ON COLUMN public.employment_links.job_role IS
  'DEPRECATED: mantido apenas para rollback. Use job_role_id.';
COMMENT ON COLUMN public.employment_links.required_documents IS
  'DEPRECATED: substituído por job_role_document_requirements + evaluate_link_compliance.';
COMMENT ON COLUMN public.worker_documents.category IS
  'DEPRECATED para lógica: derivado de document_types.category. Mantido apenas para filtros legados.';
COMMENT ON COLUMN public.worker_documents.document_type IS
  'DEPRECATED: substituído por document_type_id.';
