
-- 1) next_attempt_at agora aceita NULL (concluídos/esgotados = sem agenda).
ALTER TABLE public.worker_document_storage_cleanup_jobs
  ALTER COLUMN next_attempt_at DROP NOT NULL,
  ALTER COLUMN next_attempt_at DROP DEFAULT;

ALTER TABLE public.worker_document_storage_cleanup_jobs
  ALTER COLUMN next_attempt_at SET DEFAULT now();

-- Índice de elegibilidade (apenas jobs ativos com janela pendente).
DROP INDEX IF EXISTS public.worker_document_storage_cleanup_jobs_due_idx;
CREATE INDEX IF NOT EXISTS worker_document_storage_cleanup_jobs_due_idx
  ON public.worker_document_storage_cleanup_jobs (next_attempt_at)
  WHERE status IN ('pending','failed') AND next_attempt_at IS NOT NULL;

-- 2) Peek somente-leitura — usado por dry-run. Sem locks, sem UPDATE.
CREATE OR REPLACE FUNCTION public.peek_due_storage_cleanup_jobs(p_limit integer DEFAULT 200)
 RETURNS SETOF public.worker_document_storage_cleanup_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text := coalesce(auth.role(), '');
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 200)));
BEGIN
  IF v_role <> 'service_role' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
    END IF;
    IF NOT (public.has_role(v_uid,'admin'::public.app_role)
         OR public.has_role(v_uid,'manager'::public.app_role)
         OR public.has_role(v_uid,'operator'::public.app_role)) THEN
      RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
    END IF;
  END IF;

  RETURN QUERY
    SELECT j.*
      FROM public.worker_document_storage_cleanup_jobs AS j
     WHERE j.status IN ('pending','failed')
       AND j.attempts < j.max_attempts
       AND j.next_attempt_at IS NOT NULL
       AND j.next_attempt_at <= now()
     ORDER BY j.next_attempt_at ASC, j.created_at ASC
     LIMIT v_limit;
END;
$function$;

-- 3) Claim atômico com FOR UPDATE SKIP LOCKED + lease de 10 minutos.
CREATE OR REPLACE FUNCTION public.claim_due_storage_cleanup_jobs(p_limit integer DEFAULT 50)
 RETURNS SETOF public.worker_document_storage_cleanup_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text := coalesce(auth.role(), '');
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
BEGIN
  IF v_role <> 'service_role' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
    END IF;
    IF NOT (public.has_role(v_uid,'admin'::public.app_role)
         OR public.has_role(v_uid,'manager'::public.app_role)
         OR public.has_role(v_uid,'operator'::public.app_role)) THEN
      RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
    END IF;
  END IF;

  RETURN QUERY
    WITH due AS (
      SELECT j.id
        FROM public.worker_document_storage_cleanup_jobs AS j
       WHERE j.status IN ('pending','failed')
         AND j.attempts < j.max_attempts
         AND j.next_attempt_at IS NOT NULL
         AND j.next_attempt_at <= now()
       ORDER BY j.next_attempt_at ASC, j.created_at ASC
       LIMIT v_limit
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.worker_document_storage_cleanup_jobs AS j
       SET attempts = j.attempts + 1,
           next_attempt_at = now() + interval '10 minutes'  -- lease
     FROM due
     WHERE j.id = due.id
     RETURNING j.*;
END;
$function$;

-- 4) Mark reescrito — não incrementa attempts; concluído limpa; falha aplica backoff exponencial 30*2^(attempts-1) até cap 1h;
--    se attempts>=max_attempts a falha fica sem agenda; 'pending' aceito não consome tentativa.
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
  v_uid    uuid := auth.uid();
  v_role   text := coalesce(auth.role(), '');
  v_row    public.worker_document_storage_cleanup_jobs;
  v_current public.worker_document_storage_cleanup_jobs;
  v_next   timestamptz;
  v_backoff integer;
BEGIN
  IF v_role <> 'service_role' THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
    END IF;
    IF NOT (public.has_role(v_uid,'admin'::public.app_role)
         OR public.has_role(v_uid,'manager'::public.app_role)
         OR public.has_role(v_uid,'operator'::public.app_role)) THEN
      RAISE EXCEPTION 'forbidden_role' USING ERRCODE='42501';
    END IF;
  END IF;
  IF p_status NOT IN ('pending','completed','failed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_current
    FROM public.worker_document_storage_cleanup_jobs AS j
   WHERE j.id = p_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleanup_job_not_found' USING ERRCODE='22023';
  END IF;

  IF p_status = 'completed' THEN
    UPDATE public.worker_document_storage_cleanup_jobs AS j
       SET status          = 'completed',
           completed_at    = now(),
           last_error      = NULL,
           next_attempt_at = NULL
     WHERE j.id = p_id
     RETURNING j.* INTO v_row;
  ELSIF p_status = 'failed' THEN
    IF v_current.attempts < v_current.max_attempts THEN
      v_backoff := least(3600, (30 * power(2, greatest(0, v_current.attempts - 1)))::integer);
      v_next := now() + make_interval(secs => v_backoff);
    ELSE
      v_next := NULL;  -- esgotado: sem novo agendamento.
    END IF;
    UPDATE public.worker_document_storage_cleanup_jobs AS j
       SET status          = 'failed',
           completed_at    = NULL,
           last_error      = p_error,
           next_attempt_at = v_next
     WHERE j.id = p_id
     RETURNING j.* INTO v_row;
  ELSE  -- pending: aceita transição sem consumir tentativa nem alterar agenda.
    UPDATE public.worker_document_storage_cleanup_jobs AS j
       SET status = 'pending'
     WHERE j.id = p_id
     RETURNING j.* INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;

-- Permissões: service_role e authenticated podem executar; anon bloqueado explicitamente.
REVOKE ALL ON FUNCTION public.claim_due_storage_cleanup_jobs(integer)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.peek_due_storage_cleanup_jobs(integer)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_storage_cleanup_job_status(uuid,text,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_due_storage_cleanup_jobs(integer)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peek_due_storage_cleanup_jobs(integer)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_storage_cleanup_job_status(uuid,text,text) TO authenticated, service_role;
