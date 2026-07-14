# Rollback — Entrega 1

Instruções manuais. Nenhuma etapa executa rollback automaticamente.

## Migração 0 — `link_group_workers` unique parcial

1. Verificar se, após a aplicação, foram criadas combinações `(link_group_id, worker_id)` com um registro ativo e outro soft-deleted que **seriam proibidas** pela constraint total anterior:
   ```sql
   SELECT link_group_id, worker_id, count(*)
   FROM public.link_group_workers
   GROUP BY link_group_id, worker_id
   HAVING count(*) > 1;
   ```
2. Se não houver combinações problemáticas:
   ```sql
   DROP INDEX public.link_group_workers_unique_active_group_worker;
   ALTER TABLE public.link_group_workers
     ADD CONSTRAINT link_group_workers_link_group_id_worker_id_key
     UNIQUE (link_group_id, worker_id);
   ```
3. Se houver combinações problemáticas, **NÃO recriar** a constraint total diretamente. Gerar migration compensatória (soft-delete adicional ou reatribuição) antes.

## A1 — Preparação de normalização

### Antes de uso em produção (nenhuma escrita real feita ainda)

```sql
DROP INDEX IF EXISTS public.workers_cpf_normalized_idx;
DROP INDEX IF EXISTS public.workers_full_name_trgm_idx;
DROP INDEX IF EXISTS public.workers_email_lower_idx;
DROP INDEX IF EXISTS public.workers_phone_norm_idx;

ALTER TABLE public.workers
  DROP CONSTRAINT IF EXISTS workers_valid_cpf_check;

ALTER TABLE public.workers
  DROP COLUMN IF EXISTS registration_status,
  DROP COLUMN IF EXISTS merged_by,
  DROP COLUMN IF EXISTS merged_at,
  DROP COLUMN IF EXISTS merged_into_worker_id,
  DROP COLUMN IF EXISTS linked_profile_id,
  DROP COLUMN IF EXISTS cpf_normalized;

DROP FUNCTION IF EXISTS public.is_valid_cpf(text);
DROP TABLE IF EXISTS public.worker_duplicate_reviews;
```

### Depois de uso real (colunas com dados)

- NÃO remover colunas geradas nem novas colunas se já existirem dados dependentes.
- Desativar novos fluxos que utilizem `cpf_normalized`, `registration_status`, `linked_profile_id`.
- Reverter a versão da aplicação para a anterior à A1.
- Manter rastreabilidade — nenhum `DROP` destrutivo.
- Executar migration corretiva específica para o cenário produtivo.

## A5 — Convites e rate limit

```sql
REVOKE ALL ON FUNCTION public.claim_public_invite(text, text)   FROM PUBLIC, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_public_invite(uuid, uuid, uuid, uuid) FROM PUBLIC, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_public_invite(uuid, uuid, text)        FROM PUBLIC, authenticated, service_role;

DROP FUNCTION IF EXISTS public.claim_public_invite(text, text);
DROP FUNCTION IF EXISTS public.complete_public_invite(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.release_public_invite(uuid, uuid, text);

DROP TABLE IF EXISTS public.invite_attempts;
DROP TABLE IF EXISTS public.invites;
```

- Remover a Edge Function `public-invite-accept` do projeto.
- Remover manualmente o secret `INVITE_TOKEN_SECRET`.
- Reverter a entrada `[functions.public-invite-accept]` de `supabase/config.toml`.

## `merge_workers` v1

```sql
DROP FUNCTION IF EXISTS public.merge_workers(uuid, uuid, text);
```

A remoção da função **não desfaz** mesclagens já executadas — trabalhadores secundários já marcados com `merged_into_worker_id` permanecem consolidados. Reversão factual exige análise caso-a-caso a partir de `change_logs`.