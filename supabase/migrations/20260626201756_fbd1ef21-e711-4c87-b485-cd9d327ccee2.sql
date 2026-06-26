
-- Atribuir papel Operador para Joanny (contato@criativosholding.com.br)
INSERT INTO public.user_roles (user_id, role)
VALUES ('23fe4795-4def-4723-b722-624296296a1d', 'operator')
ON CONFLICT (user_id, role) DO NOTHING;

-- Excluir usuário Isaias (contato@tokyoeventos.com.br)
DELETE FROM public.user_roles WHERE user_id = '248e67cf-04ee-4cec-95f2-74330f309d05';
DELETE FROM public.profiles WHERE user_id = '248e67cf-04ee-4cec-95f2-74330f309d05';
DELETE FROM auth.users WHERE id = '248e67cf-04ee-4cec-95f2-74330f309d05';
