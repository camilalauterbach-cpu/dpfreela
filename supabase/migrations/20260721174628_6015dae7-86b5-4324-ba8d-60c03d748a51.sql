
-- E-ADMIN.2 · Passo 1: dry-run de reconciliação de cargos livres

CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1) Tabela de auditoria
CREATE TABLE IF NOT EXISTS public.job_role_backfill_unmatched (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_row_id UUID NOT NULL,
  original_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  suggested_slug TEXT NOT NULL,
  suggested_name TEXT NOT NULL,
  occurrences INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jrbu_source ON public.job_role_backfill_unmatched (source_table, source_row_id);
CREATE INDEX IF NOT EXISTS idx_jrbu_normalized ON public.job_role_backfill_unmatched (normalized_text);

GRANT SELECT ON public.job_role_backfill_unmatched TO authenticated;
GRANT ALL ON public.job_role_backfill_unmatched TO service_role;

ALTER TABLE public.job_role_backfill_unmatched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jrbu_read_admin_manager" ON public.job_role_backfill_unmatched;
CREATE POLICY "jrbu_read_admin_manager"
  ON public.job_role_backfill_unmatched
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]));

-- 2) Função de normalização determinística
CREATE OR REPLACE FUNCTION public.f_normalize_job_role(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
           lower(unaccent(trim(coalesce(p_text, '')))),
           '\s+', ' ', 'g'
         )
$$;

-- 3) Slug (usa search_path = public para achar unaccent)
CREATE OR REPLACE FUNCTION public.f_slugify_job_role(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
           regexp_replace(lower(unaccent(coalesce(p_text,''))), '[^a-z0-9]+', '_', 'g'),
           '(^_+|_+$)', '', 'g'
         )
$$;

-- 4) Dry-run: popula a tabela e retorna resumo
CREATE OR REPLACE FUNCTION public.dry_run_job_role_backfill()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_distinct INT;
  v_samples JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','manager']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  TRUNCATE TABLE public.job_role_backfill_unmatched;

  -- link_group_workers: sem job_role_id (coluna ainda não existe) e job_role livre sem match
  INSERT INTO public.job_role_backfill_unmatched (
    source_table, source_row_id, original_text, normalized_text, suggested_slug, suggested_name, occurrences
  )
  SELECT
    'link_group_workers',
    lgw.id,
    lgw.job_role,
    public.f_normalize_job_role(lgw.job_role),
    public.f_slugify_job_role(lgw.job_role),
    initcap(trim(lgw.job_role)),
    1
  FROM public.link_group_workers lgw
  WHERE lgw.deleted_at IS NULL
    AND lgw.job_role IS NOT NULL
    AND btrim(lgw.job_role) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.job_roles jr
      WHERE jr.is_active
        AND public.f_normalize_job_role(jr.name) = public.f_normalize_job_role(lgw.job_role)
    );

  -- employment_links: apenas se job_role_id estiver NULL e texto sem match
  INSERT INTO public.job_role_backfill_unmatched (
    source_table, source_row_id, original_text, normalized_text, suggested_slug, suggested_name, occurrences
  )
  SELECT
    'employment_links',
    el.id,
    el.job_role,
    public.f_normalize_job_role(el.job_role),
    public.f_slugify_job_role(el.job_role),
    initcap(trim(el.job_role)),
    1
  FROM public.employment_links el
  WHERE el.deleted_at IS NULL
    AND el.job_role_id IS NULL
    AND el.job_role IS NOT NULL
    AND btrim(el.job_role) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.job_roles jr
      WHERE jr.is_active
        AND public.f_normalize_job_role(jr.name) = public.f_normalize_job_role(el.job_role)
    );

  SELECT count(*), count(DISTINCT normalized_text)
    INTO v_total, v_distinct
    FROM public.job_role_backfill_unmatched;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_samples
  FROM (
    SELECT normalized_text, suggested_name, count(*) AS occurrences,
           (array_agg(DISTINCT source_table))::text[] AS sources
    FROM public.job_role_backfill_unmatched
    GROUP BY normalized_text, suggested_name
    ORDER BY count(*) DESC, normalized_text
    LIMIT 20
  ) t;

  RETURN jsonb_build_object(
    'executed_at', now(),
    'total_rows', v_total,
    'distinct_labels', v_distinct,
    'samples', v_samples,
    'blocked', (v_total > 0),
    'message', CASE WHEN v_total = 0
                    THEN 'Reconciliação vazia. Passo 2 pode ser executado.'
                    ELSE 'Existem cargos não reconciliados. Cadastre-os em Configurações → Cargos antes de prosseguir.'
               END
  );
END $$;

REVOKE ALL ON FUNCTION public.dry_run_job_role_backfill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dry_run_job_role_backfill() TO authenticated;

-- Reexecutar como validação inicial
-- (sem side-effect de dados; a função respeita RLS/role)
COMMENT ON TABLE public.job_role_backfill_unmatched IS
  'E-ADMIN.2 · Auditoria de cargos em texto livre sem correspondência em job_roles. Populada por dry_run_job_role_backfill().';
