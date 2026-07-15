-- Cleanup do convite fictício criado durante o teste de concorrência da Entrega 11
DELETE FROM public.invite_attempts
 WHERE token_hash_prefix = substring(encode(sha256('e11-conc-token'::bytea),'hex') for 8);
DELETE FROM public.invites
 WHERE id = 'c7e8a1f6-1580-4fd9-bdbd-188548a74da0'
    OR email_normalized IN ('e11-happy@test.local','e11-conf@test.local','e11-conc@test.local');