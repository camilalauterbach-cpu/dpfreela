-- Q-014.1 — Integration tests for public.calculate_document_expiry
-- Read-only. Runs entirely inside a rolled-back transaction so nothing persists.
-- Usage: psql -f scripts/tests/calculate_document_expiry.sql

BEGIN;

-- Temporary helper: pass/fail recorder scoped to this transaction.
CREATE OR REPLACE FUNCTION pg_temp.record_ok(
  label text,
  ok boolean,
  detail text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF ok THEN
    RAISE NOTICE 'PASS  %', label;
  ELSE
    RAISE WARNING 'FAIL  % — %', label, COALESCE(detail, '(no detail)');
  END IF;
  RETURN ok;
END $$;

DO $tests$
DECLARE
  fn CONSTANT text := 'public.calculate_document_expiry';
  passed int := 0;
  failed int := 0;
  err_msg text;
  err_code text;
  got date;
BEGIN
  --------------------------------------------------------------------
  -- 1. NULL handling
  --------------------------------------------------------------------
  got := public.calculate_document_expiry(NULL, 'fixed_duration', 365, 'day');
  CALL record_ok('null issue_date returns NULL regardless of mode',
                 got IS NULL, format('got=%s', got));

  got := public.calculate_document_expiry(NULL, 'no_expiry');
  CALL record_ok('null issue_date + no_expiry returns NULL',
                 got IS NULL, format('got=%s', got));

  got := public.calculate_document_expiry(NULL, NULL);
  CALL record_ok('null issue_date short-circuits before mode validation',
                 got IS NULL, format('got=%s', got));

  --------------------------------------------------------------------
  -- 2. Invalid configuration — mode NULL
  --------------------------------------------------------------------
  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', NULL);
    CALL record_ok('null mode raises', false, 'no exception thrown');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT, err_code = RETURNED_SQLSTATE;
    CALL record_ok('null mode raises invalid_validity_configuration',
      err_msg = 'invalid_validity_configuration' AND err_code = '22023',
      format('msg=%s code=%s', err_msg, err_code));
  END;

  --------------------------------------------------------------------
  -- 3. no_expiry — must reject any extra parameter
  --------------------------------------------------------------------
  got := public.calculate_document_expiry(DATE '2026-01-01', 'no_expiry');
  CALL record_ok('no_expiry returns NULL', got IS NULL, format('got=%s', got));

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'no_expiry', 1);
    CALL record_ok('no_expiry with value raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('no_expiry + value rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'no_expiry', NULL, 'day');
    CALL record_ok('no_expiry with unit raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('no_expiry + unit rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'no_expiry', NULL, NULL, DATE '2027-01-01');
    CALL record_ok('no_expiry with explicit_date raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('no_expiry + explicit_date rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  --------------------------------------------------------------------
  -- 4. explicit_date — required and must follow issue_date
  --------------------------------------------------------------------
  got := public.calculate_document_expiry(DATE '2026-01-01', 'explicit_date', NULL, NULL, DATE '2026-06-30');
  CALL record_ok('explicit_date returns provided date',
                 got = DATE '2026-06-30', format('got=%s', got));

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'explicit_date');
    CALL record_ok('explicit_date without value raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('explicit_date NULL rejected',
      err_msg = 'explicit_expiry_required', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'explicit_date', 5, NULL, DATE '2026-06-30');
    CALL record_ok('explicit_date + value raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('explicit_date + value rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'explicit_date', NULL, 'day', DATE '2026-06-30');
    CALL record_ok('explicit_date + unit raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('explicit_date + unit rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'explicit_date', NULL, NULL, DATE '2026-01-01');
    CALL record_ok('explicit_date equal to issue raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('explicit_date == issue_date rejected',
      err_msg = 'explicit_expiry_must_follow_issue_date', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-06-30', 'explicit_date', NULL, NULL, DATE '2026-01-01');
    CALL record_ok('explicit_date before issue raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('explicit_date < issue_date rejected',
      err_msg = 'explicit_expiry_must_follow_issue_date', format('msg=%s', err_msg));
  END;

  --------------------------------------------------------------------
  -- 5. fixed_duration — value/unit validation
  --------------------------------------------------------------------
  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration');
    CALL record_ok('fixed_duration null value raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('fixed_duration NULL value rejected',
      err_msg = 'validity_value_required', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 30);
    CALL record_ok('fixed_duration null unit raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('fixed_duration NULL unit rejected',
      err_msg = 'validity_unit_required', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 0, 'day');
    CALL record_ok('fixed_duration value=0 raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('fixed_duration value=0 rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', -5, 'day');
    CALL record_ok('fixed_duration negative raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('fixed_duration negative rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  BEGIN
    PERFORM public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 30, 'day', DATE '2026-06-30');
    CALL record_ok('fixed_duration + explicit_date raises', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    CALL record_ok('fixed_duration + explicit_date rejected',
      err_msg = 'invalid_validity_configuration', format('msg=%s', err_msg));
  END;

  --------------------------------------------------------------------
  -- 6. fixed_duration — happy path arithmetic
  --------------------------------------------------------------------
  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 1, 'day');
  CALL record_ok('day: 2026-01-01 + 1d = 2026-01-02',
                 got = DATE '2026-01-02', format('got=%s', got));

  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 365, 'day');
  CALL record_ok('day: 2026-01-01 + 365d = 2027-01-01',
                 got = DATE '2027-01-01', format('got=%s', got));

  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 730, 'day');
  CALL record_ok('day: 2026-01-01 + 730d = 2028-01-01',
                 got = DATE '2028-01-01', format('got=%s', got));

  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 1, 'month');
  CALL record_ok('month: 2026-01-01 + 1m = 2026-02-01',
                 got = DATE '2026-02-01', format('got=%s', got));

  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 12, 'month');
  CALL record_ok('month: 2026-01-01 + 12m = 2027-01-01',
                 got = DATE '2027-01-01', format('got=%s', got));

  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 1, 'year');
  CALL record_ok('year: 2026-01-01 + 1y = 2027-01-01',
                 got = DATE '2027-01-01', format('got=%s', got));

  --------------------------------------------------------------------
  -- 7. Calendar edge cases (matches Q-014.1 baseline behavior)
  --------------------------------------------------------------------
  -- Leap year (2024 is leap; 2025 is not) — Feb 29 + 1y clamps to Feb 28
  got := public.calculate_document_expiry(DATE '2024-02-29', 'fixed_duration', 1, 'year');
  CALL record_ok('leap: 2024-02-29 + 1y = 2025-02-28',
                 got = DATE '2025-02-28', format('got=%s', got));

  -- Jan 31 + 1 month clamps to Feb 28 (non-leap)
  got := public.calculate_document_expiry(DATE '2026-01-31', 'fixed_duration', 1, 'month');
  CALL record_ok('month clamp: 2026-01-31 + 1m = 2026-02-28',
                 got = DATE '2026-02-28', format('got=%s', got));

  -- Jan 31 + 1 month in leap year → Feb 29
  got := public.calculate_document_expiry(DATE '2024-01-31', 'fixed_duration', 1, 'month');
  CALL record_ok('leap month clamp: 2024-01-31 + 1m = 2024-02-29',
                 got = DATE '2024-02-29', format('got=%s', got));

  -- Mar 31 + 1 month clamps to Apr 30
  got := public.calculate_document_expiry(DATE '2026-03-31', 'fixed_duration', 1, 'month');
  CALL record_ok('month clamp: 2026-03-31 + 1m = 2026-04-30',
                 got = DATE '2026-04-30', format('got=%s', got));

  -- Year-crossing / large durations
  got := public.calculate_document_expiry(DATE '2026-12-31', 'fixed_duration', 1, 'day');
  CALL record_ok('year crossing: 2026-12-31 + 1d = 2027-01-01',
                 got = DATE '2027-01-01', format('got=%s', got));

  got := public.calculate_document_expiry(DATE '2026-01-01', 'fixed_duration', 100, 'year');
  CALL record_ok('century: 2026-01-01 + 100y = 2126-01-01',
                 got = DATE '2126-01-01', format('got=%s', got));

  -- Historical / pre-1970 issue date (interval arithmetic still holds)
  got := public.calculate_document_expiry(DATE '1970-01-01', 'fixed_duration', 56, 'year');
  CALL record_ok('historic: 1970-01-01 + 56y = 2026-01-01',
                 got = DATE '2026-01-01', format('got=%s', got));

  -- Timezone independence: same date arithmetic regardless of session TZ
  SET LOCAL TIME ZONE 'Pacific/Kiritimati'; -- UTC+14
  got := public.calculate_document_expiry(DATE '2024-02-29', 'fixed_duration', 1, 'year');
  CALL record_ok('tz Pacific/Kiritimati: leap clamp stable',
                 got = DATE '2025-02-28', format('got=%s', got));
  SET LOCAL TIME ZONE 'Pacific/Pago_Pago';  -- UTC-11
  got := public.calculate_document_expiry(DATE '2026-01-31', 'fixed_duration', 1, 'month');
  CALL record_ok('tz Pacific/Pago_Pago: month clamp stable',
                 got = DATE '2026-02-28', format('got=%s', got));
  RESET TIME ZONE;

  --------------------------------------------------------------------
  -- 8. IMMUTABLE contract — same inputs must produce same output
  --------------------------------------------------------------------
  CALL record_ok('deterministic (day)',
    public.calculate_document_expiry(DATE '2026-01-01','fixed_duration',730,'day')
    = public.calculate_document_expiry(DATE '2026-01-01','fixed_duration',730,'day'),
    'mismatched repeat call');

  --------------------------------------------------------------------
  RAISE NOTICE '---------------------------------------------';
  RAISE NOTICE 'calculate_document_expiry tests: % passed, % failed', passed, failed;
  IF failed > 0 THEN
    RAISE EXCEPTION '% test(s) failed', failed;
  END IF;
END
$tests$;

ROLLBACK;
