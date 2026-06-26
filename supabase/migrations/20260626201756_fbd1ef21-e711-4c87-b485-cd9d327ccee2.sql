-- Atribuição de papel e remoção de usuário específicos.
-- PII (e-mails) removida desta migração; ações originais referenciam apenas UUIDs.

INSERT INTO public.user_roles (user_id, role)
VALUES ('23fe4795-4def-4723-b722-624296296a1d', 'operator')
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles WHERE user_id = '248e67cf-04ee-4cec-95f2-74330f309d05';
DELETE FROM public.profiles WHERE user_id = '248e67cf-04ee-4cec-95f2-74330f309d05';
DELETE FROM auth.users WHERE id = '248e67cf-04ee-4cec-95f2-74330f309d05';
