
-- =========================================================================
-- Entrega 11.A — Endurecimento e RPCs administrativas de convites
-- =========================================================================

-- 1) Grants estritos (least privilege). RLS continua exigindo admin/manager
--    para SELECT em invites; anon não tem qualquer acesso. Mutações passam
--    exclusivamente pelas RPCs SECURITY DEFINER via service_role.
REVOKE ALL ON public.invites          FROM anon, authenticated;
REVOKE ALL ON public.invite_attempts  FROM anon, authenticated;
GRANT  SELECT ON public.invites TO authenticated;
GRANT  ALL    ON public.invites, public.invite_attempts TO service_role;

-- 2) Ampliar ações permitidas em change_logs
ALTER TABLE public.change_logs DROP CONSTRAINT IF EXISTS change_logs_action_check;
ALTER TABLE public.change_logs ADD CONSTRAINT change_logs_action_check
  CHECK (action = ANY (ARRAY[
    'insert','update','delete',
    'merge_workers_success','merge_conflict','merge_payroll_item_consolidated',
    'invite_accepted','worker_restored',
    'invite_created','invite_revoked','invite_resent'
  ]));

-- 3) RPC create_invite_record
CREATE OR REPLACE FUNCTION public.create_invite_record(
  _acting_user_id  uuid,
  _email           text,
  _role            public.app_role,
  _linked_worker_id uuid,
  _token_hash      text,
  _expires_at      timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email  text := lower(btrim(coalesce(_email,'')));
  v_ttl_h  numeric;
  v_worker record;
  v_id     uuid;
  v_conflict uuid;
BEGIN
  -- Defesa-em-profundidade: mesmo restrito a service_role, revalidar papel.
  IF _acting_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_any_role(_acting_user_id, ARRAY['admin'::public.app_role,'manager'::public.app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE='22023';
  END IF;
  IF _role IS NULL OR _role NOT IN ('viewer'::public.app_role, 'operator'::public.app_role) THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE='22023';
  END IF;
  IF _token_hash IS NULL OR length(_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_token_hash' USING ERRCODE='22023';
  END IF;
  IF _expires_at IS NULL THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE='22023';
  END IF;
  v_ttl_h := EXTRACT(EPOCH FROM (_expires_at - now())) / 3600.0;
  IF v_ttl_h < 1 OR v_ttl_h > 168 THEN
    RAISE EXCEPTION 'invalid_ttl' USING ERRCODE='22023';
  END IF;

  IF _linked_worker_id IS NOT NULL THEN
    SELECT id, deleted_at, linked_profile_id
      INTO v_worker FROM public.workers WHERE id = _linked_worker_id FOR UPDATE;
    IF NOT FOUND OR v_worker.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'worker_not_found' USING ERRCODE='22023';
    END IF;
    IF v_worker.linked_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'worker_already_linked' USING ERRCODE='23505';
    END IF;
  END IF;

  -- Bloqueio explícito de duplicidade pending/processing (mesma regra do UNIQUE parcial)
  SELECT id INTO v_conflict FROM public.invites
   WHERE email_normalized = v_email AND status IN ('pending','processing') LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_pending' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.invites(
    email_normalized, token_hash, role, linked_worker_id,
    status, expires_at, created_by
  ) VALUES (
    v_email, _token_hash, _role, _linked_worker_id,
    'pending', _expires_at, _acting_user_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('invites', v_id, 'invite_created',
          NULL,
          jsonb_build_object('role', _role, 'linked_worker_id', _linked_worker_id, 'expires_at', _expires_at),
          _acting_user_id);

  RETURN jsonb_build_object('result','created','invite_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_invite_record(uuid, text, public.app_role, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_invite_record(uuid, text, public.app_role, uuid, text, timestamptz) TO service_role;

-- 4) RPC revoke_invite
CREATE OR REPLACE FUNCTION public.revoke_invite(_acting_user_id uuid, _invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_inv record;
BEGIN
  IF _acting_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_any_role(_acting_user_id, ARRAY['admin'::public.app_role,'manager'::public.app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _invite_id IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_inv FROM public.invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE='22023'; END IF;
  IF v_inv.status NOT IN ('pending','processing') THEN
    RAISE EXCEPTION 'invite_not_revokable' USING ERRCODE='22023';
  END IF;

  UPDATE public.invites
     SET status='revoked',
         processing_started_at=NULL,
         processing_nonce=NULL
   WHERE id = _invite_id;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('invites', _invite_id, 'invite_revoked',
          jsonb_build_object('status', v_inv.status),
          jsonb_build_object('status','revoked'),
          _acting_user_id);

  RETURN jsonb_build_object('result','revoked','invite_id', _invite_id);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revoke_invite(uuid, uuid) TO service_role;

-- 5) RPC resend_invite: revoga o anterior e cria um novo com novo token_hash,
--    em uma única transação. O token original permanece inacessível.
CREATE OR REPLACE FUNCTION public.resend_invite(
  _acting_user_id uuid,
  _invite_id      uuid,
  _new_token_hash text,
  _expires_at     timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_new_id uuid;
  v_ttl_h numeric;
  v_worker record;
BEGIN
  IF _acting_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_any_role(_acting_user_id, ARRAY['admin'::public.app_role,'manager'::public.app_role]) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _invite_id IS NULL OR _new_token_hash IS NULL OR length(_new_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';
  END IF;
  IF _expires_at IS NULL THEN RAISE EXCEPTION 'invalid_expiry' USING ERRCODE='22023'; END IF;
  v_ttl_h := EXTRACT(EPOCH FROM (_expires_at - now())) / 3600.0;
  IF v_ttl_h < 1 OR v_ttl_h > 168 THEN
    RAISE EXCEPTION 'invalid_ttl' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_inv FROM public.invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE='22023'; END IF;
  IF v_inv.status NOT IN ('pending','processing') THEN
    RAISE EXCEPTION 'invite_not_resendable' USING ERRCODE='22023';
  END IF;

  -- Se worker vinculado, revalidar
  IF v_inv.linked_worker_id IS NOT NULL THEN
    SELECT id, deleted_at, linked_profile_id
      INTO v_worker FROM public.workers WHERE id = v_inv.linked_worker_id FOR UPDATE;
    IF NOT FOUND OR v_worker.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'worker_not_found' USING ERRCODE='22023';
    END IF;
    IF v_worker.linked_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'worker_already_linked' USING ERRCODE='23505';
    END IF;
  END IF;

  -- Revogar o convite antigo (invalida o hash antigo, libera o UNIQUE parcial por email)
  UPDATE public.invites
     SET status='revoked',
         processing_started_at=NULL,
         processing_nonce=NULL
   WHERE id = _invite_id;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('invites', _invite_id, 'invite_revoked',
          jsonb_build_object('status', v_inv.status, 'reason','resend'),
          jsonb_build_object('status','revoked'),
          _acting_user_id);

  -- Criar novo convite com mesmo email/role/worker
  INSERT INTO public.invites(
    email_normalized, token_hash, role, linked_worker_id,
    status, expires_at, created_by
  ) VALUES (
    v_inv.email_normalized, _new_token_hash, v_inv.role, v_inv.linked_worker_id,
    'pending', _expires_at, _acting_user_id
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.change_logs(table_name, record_id, action, old_data, new_data, changed_by)
  VALUES ('invites', v_new_id, 'invite_resent',
          jsonb_build_object('previous_invite_id', _invite_id),
          jsonb_build_object('role', v_inv.role, 'linked_worker_id', v_inv.linked_worker_id, 'expires_at', _expires_at),
          _acting_user_id);

  RETURN jsonb_build_object(
    'result','resent',
    'previous_invite_id', _invite_id,
    'invite_id', v_new_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resend_invite(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resend_invite(uuid, uuid, text, timestamptz) TO service_role;
