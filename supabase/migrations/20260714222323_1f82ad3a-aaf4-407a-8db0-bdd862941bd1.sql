-- A5: invites, invite_attempts e três RPCs

-- Tabela invites
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  token_hash text NOT NULL,
  role public.app_role NOT NULL,
  linked_worker_id uuid REFERENCES public.workers(id),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  processing_started_at timestamptz,
  processing_nonce uuid,
  accepted_at timestamptz,
  accepted_auth_user_id uuid,
  accepted_profile_id uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_status_check
    CHECK (status IN ('pending','processing','accepted','expired','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS invites_token_hash_key
  ON public.invites (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS invites_email_active_uniq
  ON public.invites (email_normalized)
  WHERE status IN ('pending','processing');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_admin_manager_all" ON public.invites;
CREATE POLICY "invites_admin_manager_all"
  ON public.invites FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'manager'::public.app_role]));

-- Tabela invite_attempts
CREATE TABLE IF NOT EXISTS public.invite_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL,
  token_hash_prefix text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS invite_attempts_ip_time_idx
  ON public.invite_attempts (ip_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS invite_attempts_token_time_idx
  ON public.invite_attempts (token_hash_prefix, attempted_at DESC)
  WHERE token_hash_prefix IS NOT NULL;

GRANT ALL ON public.invite_attempts TO service_role;

ALTER TABLE public.invite_attempts ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy: apenas service_role acessa (RLS bypassa para service_role).

-- ---------- claim_public_invite ----------
CREATE OR REPLACE FUNCTION public.claim_public_invite(_token_hash text, _ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip_count int;
  v_token_count int;
  v_recent_fail int;
  v_inv record;
  v_nonce uuid := gen_random_uuid();
  v_prefix text := left(coalesce(_token_hash,''), 12);
BEGIN
  IF _token_hash IS NULL OR length(_token_hash) < 16 OR _ip_hash IS NULL THEN
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success)
      VALUES (coalesce(_ip_hash,'unknown'), v_prefix, false);
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Rate limits
  SELECT count(*) INTO v_ip_count
    FROM public.invite_attempts
   WHERE ip_hash = _ip_hash
     AND attempted_at > now() - interval '10 minutes';
  IF v_ip_count >= 10 THEN
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, false);
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '42P01';
  END IF;

  SELECT count(*) INTO v_token_count
    FROM public.invite_attempts
   WHERE token_hash_prefix = v_prefix
     AND attempted_at > now() - interval '10 minutes';
  IF v_token_count >= 5 THEN
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, false);
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '42P01';
  END IF;

  SELECT count(*) INTO v_recent_fail
    FROM public.invite_attempts
   WHERE ip_hash = _ip_hash
     AND token_hash_prefix = v_prefix
     AND success = false
     AND attempted_at > now() - interval '30 minutes';
  IF v_recent_fail >= 3 THEN
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, false);
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '42P01';
  END IF;

  -- Localizar convite
  SELECT * INTO v_inv FROM public.invites WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, false);
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Expiração
  IF v_inv.expires_at < now() THEN
    UPDATE public.invites SET status='expired' WHERE id = v_inv.id AND status IN ('pending','processing');
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, false);
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Recuperar processing abandonado
  IF v_inv.status = 'processing' AND v_inv.processing_started_at IS NOT NULL
     AND v_inv.processing_started_at < now() - interval '2 minutes' THEN
    UPDATE public.invites
       SET status='pending', processing_started_at=NULL, processing_nonce=NULL
     WHERE id = v_inv.id;
    v_inv.status := 'pending';
  END IF;

  IF v_inv.status <> 'pending' THEN
    INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, false);
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- pending -> processing
  UPDATE public.invites
     SET status='processing',
         processing_started_at=now(),
         processing_nonce=v_nonce,
         attempt_count = attempt_count + 1
   WHERE id = v_inv.id AND status='pending';

  INSERT INTO public.invite_attempts(ip_hash, token_hash_prefix, success) VALUES (_ip_hash, v_prefix, true);

  RETURN jsonb_build_object(
    'invite_id', v_inv.id,
    'email', v_inv.email_normalized,
    'role', v_inv.role,
    'linked_worker_id', v_inv.linked_worker_id,
    'nonce', v_nonce
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_public_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_public_invite(text, text) TO service_role;

-- ---------- complete_public_invite ----------
CREATE OR REPLACE FUNCTION public.complete_public_invite(
  _invite_id uuid,
  _nonce uuid,
  _auth_user_id uuid,
  _profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_profile_user uuid;
  v_worker_current uuid;
BEGIN
  IF _invite_id IS NULL OR _nonce IS NULL OR _auth_user_id IS NULL OR _profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023'; END IF;

  IF v_inv.status <> 'processing' THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;
  IF v_inv.processing_nonce IS DISTINCT FROM _nonce THEN
    RAISE EXCEPTION 'invalid_nonce' USING ERRCODE = '22023';
  END IF;

  -- Profile real (id em public.profiles) e vínculo com auth user
  SELECT user_id INTO v_profile_user FROM public.profiles WHERE id = _profile_id;
  IF v_profile_user IS NULL THEN
    RAISE EXCEPTION 'profile_missing' USING ERRCODE = '22023';
  END IF;
  IF v_profile_user <> _auth_user_id THEN
    RAISE EXCEPTION 'profile_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Role (idempotente)
  INSERT INTO public.user_roles(user_id, role) VALUES (_auth_user_id, v_inv.role)
    ON CONFLICT (user_id, role) DO NOTHING;

  -- Vincular workers.linked_profile_id
  IF v_inv.linked_worker_id IS NOT NULL THEN
    SELECT linked_profile_id INTO v_worker_current
      FROM public.workers WHERE id = v_inv.linked_worker_id FOR UPDATE;
    IF v_worker_current IS NULL THEN
      UPDATE public.workers SET linked_profile_id = _profile_id
        WHERE id = v_inv.linked_worker_id;
    ELSIF v_worker_current <> _profile_id THEN
      RAISE EXCEPTION 'worker_profile_conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.invites
     SET status='accepted',
         accepted_at=now(),
         accepted_auth_user_id=_auth_user_id,
         accepted_profile_id=_profile_id,
         processing_started_at=NULL,
         processing_nonce=NULL,
         last_error_code=NULL
   WHERE id = v_inv.id;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('invites', v_inv.id, 'invite_accepted',
          jsonb_build_object('status', v_inv.status),
          jsonb_build_object('status','accepted','auth_user_id',_auth_user_id,'profile_id',_profile_id),
          _auth_user_id);

  RETURN jsonb_build_object('result','accepted','invite_id', v_inv.id);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_public_invite(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_public_invite(uuid, uuid, uuid, uuid) TO service_role;

-- ---------- release_public_invite ----------
CREATE OR REPLACE FUNCTION public.release_public_invite(
  _invite_id uuid,
  _nonce uuid,
  _error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.invites
     SET status='pending',
         processing_started_at=NULL,
         processing_nonce=NULL,
         last_error_code=_error_code
   WHERE id = _invite_id
     AND status='processing'
     AND processing_nonce = _nonce;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('released', v_updated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.release_public_invite(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_public_invite(uuid, uuid, text) TO service_role;