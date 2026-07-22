-- Q-014.1 — Foundation of canonical validity policy
-- Idempotent, transactional. Preserves legacy fields.

-- =====================================================================
-- 3.1 PRE-CHECK: invalid legacy overrides
-- =====================================================================
DO $$
DECLARE
  v_count integer;
  v_samples jsonb;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.job_role_document_requirements
   WHERE validity_days_override IS NOT NULL
     AND validity_days_override <= 0;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_samples
    FROM (
      SELECT r.id AS requirement_id, r.job_role_id, r.document_type_id,
             dt.code AS document_type_code, r.validity_days_override
        FROM public.job_role_document_requirements r
        LEFT JOIN public.document_types dt ON dt.id = r.document_type_id
       WHERE r.validity_days_override IS NOT NULL
         AND r.validity_days_override <= 0
       ORDER BY r.id
       LIMIT 20
    ) s;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Q-014.1: % overrides inválidos (<=0). Amostras: %', v_count, v_samples;
  END IF;
END
$$;

-- =====================================================================
-- 3.2 PRE-CHECK: ambiguous or invalid document_type configurations
--     (only for sst_nr / sst_aso / training)
-- =====================================================================
DO $$
DECLARE
  v_count integer;
  v_samples jsonb;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.document_types
   WHERE category IN ('sst_nr','sst_aso','training')
     AND (
       (has_expiration = false AND default_validity_days IS NOT NULL)
       OR (default_validity_days IS NOT NULL AND default_validity_days <= 0)
     );

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_samples
    FROM (
      SELECT id, code, name, category, has_expiration, default_validity_days
        FROM public.document_types
       WHERE category IN ('sst_nr','sst_aso','training')
         AND (
           (has_expiration = false AND default_validity_days IS NOT NULL)
           OR (default_validity_days IS NOT NULL AND default_validity_days <= 0)
         )
       ORDER BY id
       LIMIT 20
    ) s;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Q-014.1: % configurações de vigência ambíguas/inválidas em document_types. Amostras: %', v_count, v_samples;
  END IF;
END
$$;

-- =====================================================================
-- 4. ENUMS (idempotent)
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'document_validity_mode' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.document_validity_mode AS ENUM ('fixed_duration','explicit_date','no_expiry');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'document_validity_unit' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.document_validity_unit AS ENUM ('day','month','year');
  END IF;
END
$$;

-- =====================================================================
-- 5. DOCUMENT_TYPES — new columns
-- =====================================================================
ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS validity_mode public.document_validity_mode NULL,
  ADD COLUMN IF NOT EXISTS validity_value integer NULL,
  ADD COLUMN IF NOT EXISTS validity_unit public.document_validity_unit NULL;

-- =====================================================================
-- 6. Pre-existing partial state validation on document_types
-- =====================================================================
DO $$
DECLARE
  v_count integer;
  v_samples jsonb;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.document_types
   WHERE
     (validity_mode IS NULL AND (validity_value IS NOT NULL OR validity_unit IS NOT NULL))
     OR (validity_mode = 'fixed_duration' AND (validity_value IS NULL OR validity_value <= 0 OR validity_unit IS NULL))
     OR (validity_mode IN ('explicit_date','no_expiry') AND (validity_value IS NOT NULL OR validity_unit IS NOT NULL));

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_samples
    FROM (
      SELECT id, code, category, validity_mode, validity_value, validity_unit
        FROM public.document_types
       WHERE
         (validity_mode IS NULL AND (validity_value IS NOT NULL OR validity_unit IS NOT NULL))
         OR (validity_mode = 'fixed_duration' AND (validity_value IS NULL OR validity_value <= 0 OR validity_unit IS NULL))
         OR (validity_mode IN ('explicit_date','no_expiry') AND (validity_value IS NOT NULL OR validity_unit IS NOT NULL))
       ORDER BY id
       LIMIT 20
    ) s;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Q-014.1: % document_types com estado parcial inválido. Amostras: %', v_count, v_samples;
  END IF;
END
$$;

-- =====================================================================
-- 7. Backfill document_types (only sst_nr / sst_aso / training, only NULL rows)
-- =====================================================================
-- A. no_expiry (has_expiration=false AND default_validity_days IS NULL)
UPDATE public.document_types
   SET validity_mode = 'no_expiry',
       validity_value = NULL,
       validity_unit = NULL
 WHERE category IN ('sst_nr','sst_aso','training')
   AND validity_mode IS NULL
   AND validity_value IS NULL
   AND validity_unit IS NULL
   AND has_expiration = false
   AND default_validity_days IS NULL;

-- B. fixed_duration in days (has_expiration=true AND default_validity_days > 0)
UPDATE public.document_types
   SET validity_mode = 'fixed_duration',
       validity_value = default_validity_days,
       validity_unit = 'day'
 WHERE category IN ('sst_nr','sst_aso','training')
   AND validity_mode IS NULL
   AND validity_value IS NULL
   AND validity_unit IS NULL
   AND has_expiration = true
   AND default_validity_days IS NOT NULL
   AND default_validity_days > 0;

-- C. explicit_date (has_expiration=true AND default_validity_days IS NULL)
UPDATE public.document_types
   SET validity_mode = 'explicit_date',
       validity_value = NULL,
       validity_unit = NULL
 WHERE category IN ('sst_nr','sst_aso','training')
   AND validity_mode IS NULL
   AND validity_value IS NULL
   AND validity_unit IS NULL
   AND has_expiration = true
   AND default_validity_days IS NULL;

-- =====================================================================
-- 8. Constraint on document_types (NOT VALID → VALIDATE)
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_types_validity_policy_check'
       AND conrelid = 'public.document_types'::regclass
  ) THEN
    ALTER TABLE public.document_types
      ADD CONSTRAINT document_types_validity_policy_check CHECK (
        (validity_mode IS NULL AND validity_value IS NULL AND validity_unit IS NULL)
        OR (validity_mode = 'fixed_duration' AND validity_value IS NOT NULL AND validity_value > 0 AND validity_unit IS NOT NULL)
        OR (validity_mode IN ('explicit_date','no_expiry') AND validity_value IS NULL AND validity_unit IS NULL)
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.document_types VALIDATE CONSTRAINT document_types_validity_policy_check;

-- =====================================================================
-- 9. JOB_ROLE_DOCUMENT_REQUIREMENTS — new columns
-- =====================================================================
ALTER TABLE public.job_role_document_requirements
  ADD COLUMN IF NOT EXISTS validity_override_value integer NULL,
  ADD COLUMN IF NOT EXISTS validity_override_unit public.document_validity_unit NULL;

-- Backfill overrides (only NULL rows, only when legacy has valid positive days)
UPDATE public.job_role_document_requirements
   SET validity_override_value = validity_days_override,
       validity_override_unit = 'day'
 WHERE validity_days_override IS NOT NULL
   AND validity_days_override > 0
   AND validity_override_value IS NULL
   AND validity_override_unit IS NULL;

-- =====================================================================
-- 10. Constraint on requirements (NOT VALID → VALIDATE)
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'job_role_requirement_validity_override_check'
       AND conrelid = 'public.job_role_document_requirements'::regclass
  ) THEN
    ALTER TABLE public.job_role_document_requirements
      ADD CONSTRAINT job_role_requirement_validity_override_check CHECK (
        (validity_override_value IS NULL AND validity_override_unit IS NULL)
        OR (validity_override_value IS NOT NULL AND validity_override_value > 0 AND validity_override_unit IS NOT NULL)
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.job_role_document_requirements VALIDATE CONSTRAINT job_role_requirement_validity_override_check;

-- =====================================================================
-- 11. Comments on legacy fields
-- =====================================================================
COMMENT ON COLUMN public.document_types.has_expiration IS
  'Q-014.1 legacy — preservado durante a transição. Novas implementações devem consumir validity_mode. Remoção somente após estabilização integral da Q-014.';
COMMENT ON COLUMN public.document_types.default_validity_days IS
  'Q-014.1 legacy — preservado. Valores em dias NÃO foram convertidos para unidade calendário (mês/ano) no backfill. Consuma validity_value/validity_unit.';
COMMENT ON COLUMN public.job_role_document_requirements.validity_days_override IS
  'Q-014.1 legacy — preservado. Backfill copiou este valor para validity_override_value/unit=day sem conversão calendário.';
COMMENT ON COLUMN public.document_types.validity_mode IS
  'Q-014.1 — política canônica de vigência: fixed_duration | explicit_date | no_expiry.';
COMMENT ON COLUMN public.document_types.validity_value IS
  'Q-014.1 — inteiro positivo obrigatório quando validity_mode=fixed_duration; NULL caso contrário.';
COMMENT ON COLUMN public.document_types.validity_unit IS
  'Q-014.1 — unidade calendário (day/month/year) obrigatória quando validity_mode=fixed_duration; NULL caso contrário.';
COMMENT ON COLUMN public.job_role_document_requirements.validity_override_value IS
  'Q-014.1 — override opcional do cargo. Positivo obrigatório se unit definido.';
COMMENT ON COLUMN public.job_role_document_requirements.validity_override_unit IS
  'Q-014.1 — unidade calendário do override do cargo. Obrigatória se value definido.';

-- =====================================================================
-- 12. calculate_document_expiry — pure function
-- =====================================================================
CREATE OR REPLACE FUNCTION public.calculate_document_expiry(
  p_issue_date date,
  p_mode public.document_validity_mode,
  p_value integer DEFAULT NULL,
  p_unit public.document_validity_unit DEFAULT NULL,
  p_explicit_date date DEFAULT NULL
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_issue_date IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_mode IS NULL THEN
    RAISE EXCEPTION 'invalid_validity_configuration' USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'no_expiry' THEN
    IF p_value IS NOT NULL OR p_unit IS NOT NULL OR p_explicit_date IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_validity_configuration' USING ERRCODE = '22023';
    END IF;
    RETURN NULL;
  END IF;

  IF p_mode = 'explicit_date' THEN
    IF p_value IS NOT NULL OR p_unit IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_validity_configuration' USING ERRCODE = '22023';
    END IF;
    IF p_explicit_date IS NULL THEN
      RAISE EXCEPTION 'explicit_expiry_required' USING ERRCODE = '22023';
    END IF;
    IF p_explicit_date <= p_issue_date THEN
      RAISE EXCEPTION 'explicit_expiry_must_follow_issue_date' USING ERRCODE = '22023';
    END IF;
    RETURN p_explicit_date;
  END IF;

  IF p_mode = 'fixed_duration' THEN
    IF p_explicit_date IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_validity_configuration' USING ERRCODE = '22023';
    END IF;
    IF p_value IS NULL THEN
      RAISE EXCEPTION 'validity_value_required' USING ERRCODE = '22023';
    END IF;
    IF p_value <= 0 THEN
      RAISE EXCEPTION 'invalid_validity_configuration' USING ERRCODE = '22023';
    END IF;
    IF p_unit IS NULL THEN
      RAISE EXCEPTION 'validity_unit_required' USING ERRCODE = '22023';
    END IF;

    RETURN (CASE p_unit
      WHEN 'day'   THEN p_issue_date + make_interval(days   => p_value)
      WHEN 'month' THEN p_issue_date + make_interval(months => p_value)
      WHEN 'year'  THEN p_issue_date + make_interval(years  => p_value)
    END)::date;
  END IF;

  RAISE EXCEPTION 'invalid_validity_configuration' USING ERRCODE = '22023';
END;
$$;

-- =====================================================================
-- 13. Function privileges
-- =====================================================================
REVOKE ALL ON FUNCTION public.calculate_document_expiry(date, public.document_validity_mode, integer, public.document_validity_unit, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_document_expiry(date, public.document_validity_mode, integer, public.document_validity_unit, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_document_expiry(date, public.document_validity_mode, integer, public.document_validity_unit, date) TO authenticated;

COMMENT ON FUNCTION public.calculate_document_expiry(date, public.document_validity_mode, integer, public.document_validity_unit, date) IS
  'Q-014.1 — cálculo canônico e puro (IMMUTABLE) de vencimento documental. Não lê nem escreve tabelas. Não é consumida operacionalmente nesta fase.';

-- =====================================================================
-- 15. Post-backfill validations
-- =====================================================================
DO $$
DECLARE
  a integer; b integer; c integer; d integer; e integer; f integer; g integer; h integer; i integer;
BEGIN
  SELECT COUNT(*) INTO a FROM public.document_types
    WHERE category IN ('sst_nr','sst_aso','training') AND validity_mode IS NULL;
  IF a <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check A falhou: % tipos relevantes sem política', a; END IF;

  SELECT COUNT(*) INTO b FROM public.document_types
    WHERE validity_mode = 'fixed_duration'
      AND (validity_value IS NULL OR validity_value <= 0 OR validity_unit IS NULL);
  IF b <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check B falhou: % fixed_duration inválidos', b; END IF;

  SELECT COUNT(*) INTO c FROM public.document_types
    WHERE validity_mode IN ('explicit_date','no_expiry')
      AND (validity_value IS NOT NULL OR validity_unit IS NOT NULL);
  IF c <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check C falhou: % explicit/no_expiry inválidos', c; END IF;

  SELECT COUNT(*) INTO d FROM public.document_types
    WHERE validity_mode IS NULL AND (validity_value IS NOT NULL OR validity_unit IS NOT NULL);
  IF d <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check D falhou: % estados parciais sem modo', d; END IF;

  SELECT COUNT(*) INTO e FROM public.job_role_document_requirements
    WHERE (validity_override_value IS NULL) <> (validity_override_unit IS NULL);
  IF e <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check E falhou: % overrides parciais', e; END IF;

  SELECT COUNT(*) INTO f FROM public.job_role_document_requirements
    WHERE validity_override_value IS NOT NULL AND validity_override_value <= 0;
  IF f <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check F falhou: % overrides novos inválidos', f; END IF;

  SELECT COUNT(*) INTO g FROM public.job_role_document_requirements
    WHERE validity_days_override IS NOT NULL AND validity_days_override <= 0;
  IF g <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check G falhou: % overrides legados inválidos', g; END IF;

  SELECT COUNT(*) INTO h FROM public.document_types
    WHERE category IN ('sst_nr','sst_aso','training')
      AND default_validity_days IS NOT NULL AND default_validity_days > 0
      AND (validity_mode IS DISTINCT FROM 'fixed_duration'
        OR validity_value IS DISTINCT FROM default_validity_days
        OR validity_unit IS DISTINCT FROM 'day');
  IF h <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check H falhou: % divergências no backfill de document_types', h; END IF;

  SELECT COUNT(*) INTO i FROM public.job_role_document_requirements
    WHERE validity_days_override IS NOT NULL AND validity_days_override > 0
      AND (validity_override_value IS DISTINCT FROM validity_days_override
        OR validity_override_unit IS DISTINCT FROM 'day');
  IF i <> 0 THEN RAISE EXCEPTION 'Q-014.1 post-check I falhou: % divergências no backfill de overrides', i; END IF;
END
$$;

-- =====================================================================
-- 14. Calendar tests (inline, transactional — abort on failure)
-- =====================================================================
DO $$
DECLARE
  r date;
  ok boolean;
BEGIN
  -- 1. 90 days
  r := public.calculate_document_expiry('2026-01-01','fixed_duration',90,'day',NULL);
  IF r <> DATE '2026-04-01' THEN RAISE EXCEPTION 'cal#1 falhou: %', r; END IF;

  -- 2. 6 months on 2026-01-31
  r := public.calculate_document_expiry('2026-01-31','fixed_duration',6,'month',NULL);
  IF r <> DATE '2026-07-31' THEN RAISE EXCEPTION 'cal#2 falhou: %', r; END IF;

  -- 3. 1 year
  r := public.calculate_document_expiry('2026-03-15','fixed_duration',1,'year',NULL);
  IF r <> DATE '2027-03-15' THEN RAISE EXCEPTION 'cal#3 falhou: %', r; END IF;

  -- 4. 2 years
  r := public.calculate_document_expiry('2026-08-10','fixed_duration',2,'year',NULL);
  IF r <> DATE '2028-08-10' THEN RAISE EXCEPTION 'cal#4 falhou: %', r; END IF;

  -- 5. leap year 2024-02-29 + 1 year → 2025-02-28
  r := public.calculate_document_expiry('2024-02-29','fixed_duration',1,'year',NULL);
  IF r <> DATE '2025-02-28' THEN RAISE EXCEPTION 'cal#5 falhou: %', r; END IF;

  -- 6. end of month 2026-01-31 + 1 month → 2026-02-28
  r := public.calculate_document_expiry('2026-01-31','fixed_duration',1,'month',NULL);
  IF r <> DATE '2026-02-28' THEN RAISE EXCEPTION 'cal#6 falhou: %', r; END IF;

  -- 7. no_expiry
  r := public.calculate_document_expiry('2026-01-01','no_expiry',NULL,NULL,NULL);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'cal#7 falhou: %', r; END IF;

  -- 8. explicit_date valid
  r := public.calculate_document_expiry('2026-01-01','explicit_date',NULL,NULL,DATE '2026-12-31');
  IF r <> DATE '2026-12-31' THEN RAISE EXCEPTION 'cal#8 falhou: %', r; END IF;

  -- 9. explicit_date equal → explicit_expiry_must_follow_issue_date
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','explicit_date',NULL,NULL,DATE '2026-01-01');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'explicit_expiry_must_follow_issue_date' THEN ok := true; ELSE RAISE EXCEPTION 'cal#9 mensagem errada: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#9 não levantou exceção'; END IF;

  -- 10. explicit_date earlier
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-06-01','explicit_date',NULL,NULL,DATE '2026-01-01');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'explicit_expiry_must_follow_issue_date' THEN ok := true; ELSE RAISE EXCEPTION 'cal#10 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#10 não levantou'; END IF;

  -- 11. fixed_duration missing value
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','fixed_duration',NULL,'day',NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'validity_value_required' THEN ok := true; ELSE RAISE EXCEPTION 'cal#11 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#11 não levantou'; END IF;

  -- 12. fixed_duration missing unit
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','fixed_duration',90,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'validity_unit_required' THEN ok := true; ELSE RAISE EXCEPTION 'cal#12 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#12 não levantou'; END IF;

  -- 13. value = 0
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','fixed_duration',0,'day',NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid_validity_configuration' THEN ok := true; ELSE RAISE EXCEPTION 'cal#13 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#13 não levantou'; END IF;

  -- 14. value negative
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','fixed_duration',-5,'day',NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid_validity_configuration' THEN ok := true; ELSE RAISE EXCEPTION 'cal#14 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#14 não levantou'; END IF;

  -- 15. no_expiry with value
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','no_expiry',90,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid_validity_configuration' THEN ok := true; ELSE RAISE EXCEPTION 'cal#15 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#15 não levantou'; END IF;

  -- 16. no_expiry with explicit date
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','no_expiry',NULL,NULL,DATE '2027-01-01');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid_validity_configuration' THEN ok := true; ELSE RAISE EXCEPTION 'cal#16 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#16 não levantou'; END IF;

  -- 17. explicit_date with unit
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','explicit_date',NULL,'day',DATE '2027-01-01');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid_validity_configuration' THEN ok := true; ELSE RAISE EXCEPTION 'cal#17 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#17 não levantou'; END IF;

  -- 18. fixed_duration with explicit date
  ok := false;
  BEGIN
    r := public.calculate_document_expiry('2026-01-01','fixed_duration',90,'day',DATE '2027-01-01');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid_validity_configuration' THEN ok := true; ELSE RAISE EXCEPTION 'cal#18 msg: %', SQLERRM; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cal#18 não levantou'; END IF;

  -- 19. issue_date NULL
  r := public.calculate_document_expiry(NULL,'fixed_duration',90,'day',NULL);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'cal#19 falhou: %', r; END IF;
END
$$;
