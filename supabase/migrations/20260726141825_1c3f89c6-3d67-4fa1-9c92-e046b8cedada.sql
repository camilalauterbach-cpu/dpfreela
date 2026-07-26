
ALTER TABLE public.worker_document_storage_cleanup_jobs
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8;

CREATE INDEX IF NOT EXISTS worker_document_storage_cleanup_jobs_due_idx
  ON public.worker_document_storage_cleanup_jobs (status, next_attempt_at)
  WHERE status IN ('pending','failed');

-- Listing: only jobs whose retry window arrived and that still have attempts left.
CREATE OR REPLACE FUNCTION public.list_pending_storage_cleanup_jobs(p_limit integer DEFAULT 200)
 RETURNS SETOF public.worker_document_storage_cleanup_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.worker_document_storage_cleanup_jobs
     WHERE status IN ('pending','failed')
       AND attempts < max_attempts
       AND next_attempt_at <= now()
     ORDER BY next_attempt_at ASC, created_at ASC
     LIMIT greatest(1, coalesce(p_limit, 200));
END;
$function$;

-- Marking: exponential backoff on failure, clears schedule on completion.
CREATE OR REPLACE FUNCTION public.mark_storage_cleanup_job_status(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL
)
 RETURNS public.worker_document_storage_cleanup_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.worker_document_storage_cleanup_jobs;
  v_backoff_seconds integer;
  v_next timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT (public.has_role(v_uid,'admin'::public.app_role)
       OR public.has_role(v_uid,'manager'::public.app_role)
       OR public.has_role(v_uid,'operator'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('pending','completed','failed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023';
  END IF;

  UPDATE public.worker_document_storage_cleanup_jobs j
     SET attempts = j.attempts + 1,
         status = p_status,
         last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE p_error END,
         completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE j.completed_at END,
         next_attempt_at = CASE
           WHEN p_status = 'completed' THEN j.next_attempt_at
           WHEN p_status = 'failed' AND (j.attempts + 1) < j.max_attempts THEN
             -- exponential backoff: 30s, 1m, 2m, 4m, 8m, ... capped at 1h.
             now() + make_interval(secs => LEAST(3600, 30 * power(2, j.attempts)::int))
           ELSE j.next_attempt_at
         END
   WHERE id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleanup_job_not_found' USING ERRCODE='22023';
  END IF;
  RETURN v_row;
END;
$function$;
