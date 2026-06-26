REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_audit_user_emails(uuid[]) FROM anon;

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE u.email = _email
    AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role])
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_audit_user_emails(_user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.id AS user_id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY(_user_ids)
    AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role]);
$$;

GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_user_emails(uuid[]) TO authenticated;