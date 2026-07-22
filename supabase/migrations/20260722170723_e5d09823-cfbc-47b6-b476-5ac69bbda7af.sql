
CREATE TABLE IF NOT EXISTS public.job_roles_hygiene_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_schema_version  integer NOT NULL DEFAULT 1,
  generated_at           timestamptz NOT NULL,
  saved_at               timestamptz NOT NULL DEFAULT now(),
  generated_by           uuid NOT NULL,
  criterion              text NOT NULL,
  report                 jsonb NOT NULL,
  summary                jsonb NOT NULL,
  baseline               jsonb NOT NULL,
  report_hash            text NOT NULL,
  data_fingerprint       text NOT NULL,
  CONSTRAINT job_roles_hygiene_snapshots_criterion_check
    CHECK (criterion IN ('not_deleted','vigent','status_active','status_active_and_vigent'))
);

CREATE INDEX IF NOT EXISTS idx_jrhs_saved_at ON public.job_roles_hygiene_snapshots (saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_jrhs_generated_by ON public.job_roles_hygiene_snapshots (generated_by);

COMMENT ON TABLE public.job_roles_hygiene_snapshots IS
  'Snapshot administrativo append-only do relatório dry_run_job_roles_hygiene. Não autoriza automaticamente nenhuma mutação: ações futuras devem revalidar fingerprint e pré-condições via assert_job_roles_hygiene_snapshot.';
COMMENT ON COLUMN public.job_roles_hygiene_snapshots.criterion IS
  'Critério de vínculo corrente aplicado à RPC: not_deleted | vigent | status_active | status_active_and_vigent.';
COMMENT ON COLUMN public.job_roles_hygiene_snapshots.report IS 'JSONB completo devolvido por dry_run_job_roles_hygiene no momento da captura.';
COMMENT ON COLUMN public.job_roles_hygiene_snapshots.baseline IS 'Contagens de preservação de cargos, vínculos, alocações e grupos (com IDs) no momento da captura.';
COMMENT ON COLUMN public.job_roles_hygiene_snapshots.report_hash IS 'md5 determinístico do JSONB do relatório.';
COMMENT ON COLUMN public.job_roles_hygiene_snapshots.data_fingerprint IS 'md5 determinístico das linhas relevantes de job_roles + employment_links + link_group_workers + job_role_document_requirements.';

GRANT SELECT ON public.job_roles_hygiene_snapshots TO authenticated;
GRANT ALL    ON public.job_roles_hygiene_snapshots TO service_role;

ALTER TABLE public.job_roles_hygiene_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_job_roles_hygiene_snapshots" ON public.job_roles_hygiene_snapshots;
CREATE POLICY "select_job_roles_hygiene_snapshots"
  ON public.job_roles_hygiene_snapshots
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role]));

CREATE OR REPLACE FUNCTION public.f_block_job_roles_hygiene_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION 'job_roles_hygiene_snapshot_immutable';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_jrhs_block_update ON public.job_roles_hygiene_snapshots;
CREATE TRIGGER trg_jrhs_block_update
  BEFORE UPDATE ON public.job_roles_hygiene_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.f_block_job_roles_hygiene_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_jrhs_block_delete ON public.job_roles_hygiene_snapshots;
CREATE TRIGGER trg_jrhs_block_delete
  BEFORE DELETE ON public.job_roles_hygiene_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.f_block_job_roles_hygiene_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.f_job_roles_hygiene_data_fingerprint()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH
  jr AS (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) AS j
    FROM (SELECT id, code, name, is_active, updated_at FROM public.job_roles) x
  ),
  el AS (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) AS j
    FROM (
      SELECT id, worker_id, event_id, job_role_id, job_role, job_function,
             status, hire_date, end_date, deleted_at, updated_at
      FROM public.employment_links
    ) x
  ),
  lgw AS (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) AS j
    FROM (
      SELECT id, worker_id, link_group_id, job_role_id, job_role, job_function,
             status, hire_date, end_date, deleted_at, updated_at
      FROM public.link_group_workers
    ) x
  ),
  jrdr AS (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) AS j
    FROM (
      SELECT id, job_role_id, document_type_id, is_mandatory,
             validity_days_override, display_order, updated_at
      FROM public.job_role_document_requirements
    ) x
  )
  SELECT md5(
    coalesce(jr.j::text,'[]')  || '|' ||
    coalesce(el.j::text,'[]')  || '|' ||
    coalesce(lgw.j::text,'[]') || '|' ||
    coalesce(jrdr.j::text,'[]')
  )
  FROM jr, el, lgw, jrdr;
$fn$;

REVOKE ALL ON FUNCTION public.f_job_roles_hygiene_data_fingerprint() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.f_job_roles_hygiene_data_fingerprint() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.f_job_roles_hygiene_baseline()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH
  jr AS (
    SELECT
      COUNT(*)                                    AS total,
      COUNT(*) FILTER (WHERE is_active)           AS active,
      COUNT(*) FILTER (WHERE NOT is_active)       AS inactive
    FROM public.job_roles
  ),
  el AS (
    SELECT
      COUNT(*)                                    AS total,
      COUNT(*) FILTER (WHERE deleted_at IS NULL)  AS not_deleted
    FROM public.employment_links
  ),
  lgw AS (
    SELECT
      COUNT(*)                                                AS total,
      COUNT(*) FILTER (WHERE deleted_at IS NULL)              AS not_deleted,
      COUNT(*) FILTER (WHERE job_role_id IS NOT NULL)         AS with_role_id,
      COUNT(*) FILTER (WHERE job_role_id IS NULL)             AS without_role_id
    FROM public.link_group_workers
  ),
  jrdr AS ( SELECT COUNT(*) AS total FROM public.job_role_document_requirements ),
  groups AS (
    SELECT jsonb_agg(g ORDER BY (g->>'link_group_id')) AS j
    FROM (
      SELECT jsonb_build_object(
               'link_group_id',          lg.id,
               'event_id',               lg.event_id,
               'group_name',             lg.group_name,
               'status',                 lg.status,
               'total_allocations',      COALESCE(a.total, 0),
               'not_deleted',            COALESCE(a.not_deleted, 0),
               'active_allocations',     COALESCE(a.active, 0),
               'historical_allocations', COALESCE(a.historical, 0)
             ) AS g
      FROM public.link_groups lg
      LEFT JOIN (
        SELECT link_group_id,
               COUNT(*)                                                            AS total,
               COUNT(*) FILTER (WHERE deleted_at IS NULL)                          AS not_deleted,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')    AS active,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'active')   AS historical
        FROM public.link_group_workers
        GROUP BY link_group_id
      ) a ON a.link_group_id = lg.id
    ) s
  )
  SELECT jsonb_build_object(
    'job_roles_total',                        jr.total,
    'job_roles_active',                       jr.active,
    'job_roles_inactive',                     jr.inactive,
    'employment_links_total',                 el.total,
    'employment_links_not_deleted',           el.not_deleted,
    'link_group_workers_total',               lgw.total,
    'link_group_workers_not_deleted',         lgw.not_deleted,
    'link_group_workers_with_job_role_id',    lgw.with_role_id,
    'link_group_workers_without_job_role_id', lgw.without_role_id,
    'requirements_total',                     jrdr.total,
    'group_worker_counts',                    COALESCE(groups.j, '[]'::jsonb)
  )
  FROM jr, el, lgw, jrdr, groups;
$fn$;

REVOKE ALL ON FUNCTION public.f_job_roles_hygiene_baseline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.f_job_roles_hygiene_baseline() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_job_roles_hygiene_snapshot(
  p_criterion text DEFAULT 'status_active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_report       jsonb;
  v_summary      jsonb;
  v_baseline     jsonb;
  v_hash         text;
  v_fp           text;
  v_generated_at timestamptz;
  v_id           uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.has_role(v_uid,'admin'::app_role) OR public.has_role(v_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_criterion NOT IN ('not_deleted','vigent','status_active','status_active_and_vigent') THEN
    RAISE EXCEPTION 'invalid_criterion: %', p_criterion USING ERRCODE = '22023';
  END IF;

  v_report := public.dry_run_job_roles_hygiene(p_criterion);

  IF v_report IS NULL THEN
    RAISE EXCEPTION 'report_null';
  END IF;

  v_summary := v_report -> 'summary';

  IF v_summary IS NULL
     OR COALESCE((v_summary->>'cardinality_ok')::boolean, false) IS DISTINCT FROM true
     OR (v_summary->>'input_allocation_rows')::bigint
        IS DISTINCT FROM (v_summary->>'classified_allocation_rows')::bigint
  THEN
    RAISE EXCEPTION 'cardinality_mismatch';
  END IF;

  v_generated_at := COALESCE(
    (v_report->>'generated_at')::timestamptz,
    now()
  );

  v_baseline := public.f_job_roles_hygiene_baseline();
  v_fp       := public.f_job_roles_hygiene_data_fingerprint();
  v_hash     := md5(v_report::text);

  INSERT INTO public.job_roles_hygiene_snapshots (
    generated_at, generated_by, criterion,
    report, summary, baseline, report_hash, data_fingerprint
  ) VALUES (
    v_generated_at, v_uid, p_criterion,
    v_report, v_summary, v_baseline, v_hash, v_fp
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'snapshot_id',      v_id,
    'generated_at',     v_generated_at,
    'saved_at',         now(),
    'criterion',        p_criterion,
    'report_hash',      v_hash,
    'data_fingerprint', v_fp,
    'baseline',         v_baseline,
    'summary',          v_summary
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_job_roles_hygiene_snapshot(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_job_roles_hygiene_snapshot(text) TO authenticated;

COMMENT ON FUNCTION public.save_job_roles_hygiene_snapshot(text) IS
  'Q-004.A — Grava snapshot append-only do dry_run_job_roles_hygiene. Falha se relatório nulo, critério inválido ou cardinalidade divergir. Apenas admin/manager.';

CREATE OR REPLACE FUNCTION public.assert_job_roles_hygiene_snapshot(
  p_snapshot_id uuid,
  p_max_age interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_row    public.job_roles_hygiene_snapshots%ROWTYPE;
  v_now_fp text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::app_role) OR public.has_role(v_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.job_roles_hygiene_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapshot_not_found';
  END IF;

  IF now() - v_row.saved_at > p_max_age THEN
    RAISE EXCEPTION 'snapshot_expired';
  END IF;

  v_now_fp := public.f_job_roles_hygiene_data_fingerprint();
  IF v_now_fp IS DISTINCT FROM v_row.data_fingerprint THEN
    RAISE EXCEPTION 'snapshot_stale';
  END IF;

  RETURN jsonb_build_object(
    'snapshot_id',      v_row.id,
    'generated_at',     v_row.generated_at,
    'saved_at',         v_row.saved_at,
    'criterion',        v_row.criterion,
    'report_hash',      v_row.report_hash,
    'data_fingerprint', v_row.data_fingerprint
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.assert_job_roles_hygiene_snapshot(uuid, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_job_roles_hygiene_snapshot(uuid, interval) TO authenticated;

COMMENT ON FUNCTION public.assert_job_roles_hygiene_snapshot(uuid, interval) IS
  'Q-004.A — Valida idade e fingerprint de um snapshot. Não consumido por mutações nesta sub-entrega; contrato para Q-004.B/C/D.';
