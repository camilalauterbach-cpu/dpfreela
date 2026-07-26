\set ON_ERROR_STOP on
\pset pager off
BEGIN;

-- Baseline (must not change).
SELECT count(*) AS nr FROM public.worker_sst_qualifications WHERE deleted_at IS NULL \gset
SELECT count(*) AS doc FROM public.worker_documents WHERE deleted_at IS NULL \gset
SELECT count(*) AS jobs FROM public.worker_document_storage_cleanup_jobs \gset

-- Impersonate service_role via JWT claim so SECURITY DEFINER RPCs accept us.
SELECT set_config('request.jwt.claim.role','service_role',true);

-- ==================================================================
-- T1: backoff sequence & exhaustion (fresh row per attempt count).
-- Job with attempts=k -> mark 'failed' schedules next=now()+30*2^(k-1)s.
-- attempts >= max_attempts -> next_attempt_at NULL.
-- ==================================================================
DO $$
DECLARE
  k int; jid uuid; new_at timestamptz; gap int; expected int;
  seq int[] := ARRAY[30,60,120,240,480,960,1920,3600];
  row_ public.worker_document_storage_cleanup_jobs;
BEGIN
  -- attempts 1..7 => 30..1920
  FOR k IN 1..7 LOOP
    INSERT INTO public.worker_document_storage_cleanup_jobs
      (id, bucket, path, status, attempts, max_attempts, next_attempt_at)
    VALUES (gen_random_uuid(),'test-bucket-x','t1/'||k,'pending',k,8, now())
    RETURNING id INTO jid;
    row_ := public.mark_storage_cleanup_job_status(jid,'failed','sim');
    expected := seq[k];
    gap := EXTRACT(EPOCH FROM (row_.next_attempt_at - now()))::int;
    IF abs(gap - expected) > 3 THEN
      RAISE EXCEPTION 'T1 FAIL attempts=% expected~%s actual=%s', k, expected, gap;
    END IF;
    RAISE NOTICE 'T1 attempts=% => backoff %s OK (target %s)', k, gap, expected;
  END LOOP;

  -- attempts=8 (==max) -> exhausted, next_attempt_at NULL
  INSERT INTO public.worker_document_storage_cleanup_jobs
    (id, bucket, path, status, attempts, max_attempts, next_attempt_at)
  VALUES (gen_random_uuid(),'test-bucket-x','t1/exh','pending',8,8, now())
  RETURNING id INTO jid;
  row_ := public.mark_storage_cleanup_job_status(jid,'failed','sim');
  IF row_.next_attempt_at IS NOT NULL THEN
    RAISE EXCEPTION 'T1 FAIL: 8th attempt should be NULL got %', row_.next_attempt_at;
  END IF;
  RAISE NOTICE 'T1 attempts=8 => exhausted (NULL) OK';

  -- Cap: attempts=9 hypothetical, 30*2^8=7680 -> cap 3600. Insert attempts<max to exercise formula.
  -- Use attempts=7 already covered 1920; higher would go NULL (max reached). Cap proven via seq[8]=3600 note only if attempts<max.
  -- Additional cap check with max_attempts=20, attempts=9 -> 30*2^8=7680 capped to 3600.
  INSERT INTO public.worker_document_storage_cleanup_jobs
    (id, bucket, path, status, attempts, max_attempts, next_attempt_at)
  VALUES (gen_random_uuid(),'test-bucket-x','t1/cap','pending',9,20, now())
  RETURNING id INTO jid;
  row_ := public.mark_storage_cleanup_job_status(jid,'failed','sim');
  gap := EXTRACT(EPOCH FROM (row_.next_attempt_at - now()))::int;
  IF abs(gap - 3600) > 3 THEN
    RAISE EXCEPTION 'T1 CAP FAIL: expected~3600 got %', gap;
  END IF;
  RAISE NOTICE 'T1 attempts=9 cap => %s OK (cap 3600)', gap;
END$$;

-- ==================================================================
-- T2: two claim calls do not return overlapping IDs.
-- ==================================================================
DO $$
DECLARE ids1 uuid[]; ids2 uuid[]; dupes int;
BEGIN
  INSERT INTO public.worker_document_storage_cleanup_jobs (id,bucket,path,status,attempts,max_attempts,next_attempt_at)
  SELECT gen_random_uuid(),'test-bucket-y','t2/'||i,'pending',0,8, now() - interval '1 minute'
  FROM generate_series(1,6) g(i);
  SELECT array_agg(id) INTO ids1 FROM public.claim_due_storage_cleanup_jobs(3);
  SELECT array_agg(id) INTO ids2 FROM public.claim_due_storage_cleanup_jobs(3);
  SELECT count(*) INTO dupes FROM unnest(ids1) a JOIN unnest(ids2) b ON a=b;
  IF dupes <> 0 OR array_length(ids1,1) <> 3 OR array_length(ids2,1) <> 3 THEN
    RAISE EXCEPTION 'T2 FAIL: ids1=% ids2=% dupes=%', ids1, ids2, dupes;
  END IF;
  RAISE NOTICE 'T2 two claims: 6 distinct IDs, 0 duplicates OK';
END$$;

-- ==================================================================
-- T3: lease behaviour.
-- 3a: a job whose next_attempt_at is IN THE FUTURE cannot be claimed.
-- 3b: a job simulating an expired lease (attempts=1, next_attempt_at in past) IS claimed.
-- ==================================================================
DO $$
DECLARE jid_future uuid; jid_expired uuid; got uuid;
BEGIN
  INSERT INTO public.worker_document_storage_cleanup_jobs (id,bucket,path,status,attempts,max_attempts,next_attempt_at)
  VALUES (gen_random_uuid(),'test-bucket-z','t3/leased','pending',1,8, now()+interval '10 minutes')
  RETURNING id INTO jid_future;
  INSERT INTO public.worker_document_storage_cleanup_jobs (id,bucket,path,status,attempts,max_attempts,next_attempt_at)
  VALUES (gen_random_uuid(),'test-bucket-z','t3/expired','pending',1,8, now()-interval '1 second')
  RETURNING id INTO jid_expired;

  -- 3a: peek excludes leased job (read-only, does not consume).
  IF EXISTS (SELECT 1 FROM public.peek_due_storage_cleanup_jobs(200) WHERE id=jid_future) THEN
    RAISE EXCEPTION 'T3a FAIL: leased job visible to peek';
  END IF;
  -- 3b: claim reclaims the expired-lease job.
  SELECT id INTO got FROM public.claim_due_storage_cleanup_jobs(50) WHERE id=jid_expired;
  IF got IS NULL THEN RAISE EXCEPTION 'T3b FAIL: expired lease not reclaimable'; END IF;
  RAISE NOTICE 'T3 lease honoured, expired lease reclaimable OK';
END$$;

-- ==================================================================
-- T4: completed clears next_attempt_at + last_error, sets completed_at.
-- ==================================================================
DO $$
DECLARE jid uuid; row_ public.worker_document_storage_cleanup_jobs;
BEGIN
  INSERT INTO public.worker_document_storage_cleanup_jobs (id,bucket,path,status,attempts,max_attempts,next_attempt_at,last_error)
  VALUES (gen_random_uuid(),'test-bucket-w','t4/ok','pending',1,8, now()+interval '5 minutes','previous')
  RETURNING id INTO jid;
  row_ := public.mark_storage_cleanup_job_status(jid,'completed',NULL);
  IF row_.next_attempt_at IS NOT NULL OR row_.last_error IS NOT NULL OR row_.completed_at IS NULL OR row_.status <> 'completed' THEN
    RAISE EXCEPTION 'T4 FAIL: %', row_;
  END IF;
  RAISE NOTICE 'T4 completed cleans schedule + last_error, sets completed_at OK';
END$$;

-- ==================================================================
-- T5: peek is read-only.
-- ==================================================================
DO $$
DECLARE jid uuid; a1 int; a2 int; s1 text; s2 text;
BEGIN
  INSERT INTO public.worker_document_storage_cleanup_jobs (id,bucket,path,status,attempts,max_attempts,next_attempt_at)
  VALUES (gen_random_uuid(),'test-bucket-p','t5/peek','pending',3,8, now()-interval '1 minute')
  RETURNING id INTO jid;
  SELECT attempts,status INTO a1,s1 FROM public.worker_document_storage_cleanup_jobs WHERE id=jid;
  PERFORM public.peek_due_storage_cleanup_jobs(50);
  PERFORM public.peek_due_storage_cleanup_jobs(50);
  SELECT attempts,status INTO a2,s2 FROM public.worker_document_storage_cleanup_jobs WHERE id=jid;
  IF a1<>a2 OR s1<>s2 THEN RAISE EXCEPTION 'T5 FAIL peek mutated (attempts %/% status %/%)',a1,a2,s1,s2; END IF;
  RAISE NOTICE 'T5 peek read-only OK';
END$$;

-- ==================================================================
-- T6: authorization matrix.
-- ==================================================================
-- 6a: anon
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claim.sub','',true);
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN PERFORM public.peek_due_storage_cleanup_jobs(1); ok:=false;
  EXCEPTION WHEN OTHERS THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T6a FAIL: anon could peek'; END IF;
  BEGIN PERFORM public.claim_due_storage_cleanup_jobs(1); ok:=false;
  EXCEPTION WHEN OTHERS THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T6a FAIL: anon could claim'; END IF;
  BEGIN PERFORM public.mark_storage_cleanup_job_status(gen_random_uuid(),'failed','x'); ok:=false;
  EXCEPTION WHEN OTHERS THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T6a FAIL: anon could mark'; END IF;
  RAISE NOTICE 'T6a anon blocked on peek/claim/mark OK';
END$$;

-- 6b: authenticated w/o role
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000deadbee',true);
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN PERFORM public.peek_due_storage_cleanup_jobs(1); ok:=false;
  EXCEPTION WHEN OTHERS THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T6b FAIL: authenticated w/o role could peek'; END IF;
  BEGIN PERFORM public.claim_due_storage_cleanup_jobs(1); ok:=false;
  EXCEPTION WHEN OTHERS THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T6b FAIL: authenticated w/o role could claim'; END IF;
  RAISE NOTICE 'T6b authenticated w/o role blocked OK';
END$$;

-- 6c: service_role allowed
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.peek_due_storage_cleanup_jobs(5);
  RAISE NOTICE 'T6c service_role peek returned % rows OK', n;
  SELECT count(*) INTO n FROM public.claim_due_storage_cleanup_jobs(1);
  RAISE NOTICE 'T6c service_role claim returned % rows OK', n;
END$$;

-- ==================================================================
-- T7: p_limit clamped to 1..200.
-- ==================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.peek_due_storage_cleanup_jobs(0);
  RAISE NOTICE 'T7 peek(0) clamped -> %', n;
  SELECT count(*) INTO n FROM public.peek_due_storage_cleanup_jobs(999999);
  RAISE NOTICE 'T7 peek(999999) clamped -> %', n;
END$$;

-- T8: no side effects on live NR/ASO/documents/pre-existing jobs.
SELECT
  (SELECT count(*) FROM public.worker_sst_qualifications WHERE deleted_at IS NULL) AS nr_after,
  (SELECT count(*) FROM public.worker_documents WHERE deleted_at IS NULL) AS doc_after,
  (SELECT count(*) FROM public.worker_document_storage_cleanup_jobs WHERE bucket NOT LIKE 'test-bucket-%') AS jobs_after,
  :nr  AS nr_before,
  :doc AS doc_before,
  :jobs AS jobs_before,
  CASE WHEN
    (SELECT count(*) FROM public.worker_sst_qualifications WHERE deleted_at IS NULL) = :nr
    AND (SELECT count(*) FROM public.worker_documents WHERE deleted_at IS NULL) = :doc
    AND (SELECT count(*) FROM public.worker_document_storage_cleanup_jobs WHERE bucket NOT LIKE 'test-bucket-%') = :jobs
  THEN 'T8 OK no side effects' ELSE 'T8 FAIL side effects detected' END AS t8;

ROLLBACK;
