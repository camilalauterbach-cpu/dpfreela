# Entrega 1 — Execução da especificação congelada

**Fonte única e literal:** o conteúdo integral que você acabou de enviar será salvo em `.lovable/entrega-1-deduplicacao-convites.md` e servirá como especificação exclusiva. Nada será resumido, reescrito ou reordenado.

## Ações ao entrar em build

1. Salvar cópia literal em `.lovable/entrega-1-deduplicacao-convites.md` (sem tocar em `.lovable/plan.md`).
2. Confirmar schema real via `information_schema` antes de gerar DDLs (colunas de `workers`, `link_group_workers`, `payroll_batch_items`, `change_logs`, `profiles`, `worker_dependents`, `worker_documents`, `worker_payment_methods`, `employment_link_documents`, `employment_links`).
3. Gerar a matriz real em `.lovable/matrices/payroll_batch_items.md` a partir de `information_schema.columns`.
4. Criar, exatamente na ordem e com os contratos da spec:
   - Migração 0 (`_lgw_partial_unique.sql`) com dry-run interno `RAISE EXCEPTION` se houver duplicidade ativa.
   - Migração A1 (`_workers_normalization_prep.sql`) com `pg_trgm`, colunas geradas `cpf_normalized` e `document_number_normalized`, colunas novas em `workers`, `is_valid_cpf`, `workers_valid_cpf_check NOT VALID`, índices não-únicos, tabela `worker_duplicate_reviews` com GRANT + RLS admin-only.
   - `scripts/sst-dedup-dry-run.sql` somente-leitura (sem `INSERT/UPDATE/DELETE/ALTER/DROP/CREATE`), com máscaras e `\copy` para `/mnt/documents/sst-dedup-dry-run-<data>.csv`.
   - Migração `_rpc_ensure_worker.sql` — assinatura `ensure_worker(payload jsonb, mode text default 'auto')`, `SECURITY DEFINER`, REVOKE/GRANT, validação estrita de CPF (11 dígitos + `is_valid_cpf`), matriz de roles por `mode`, busca exata → fuzzy mascarada → criação.
   - Migração A5 (`_invites.sql`) — tabelas `invites` (com `accepted_auth_user_id`, `accepted_profile_id`, `attempt_count`, `last_error_code`, estados `pending/processing/accepted/expired/revoked`) e `invite_attempts`, uniques (incluindo parcial em `email_normalized`), RLS, e as três RPCs `claim_public_invite` / `complete_public_invite` / `release_public_invite` (service_role only) com rate limit persistente conforme spec (10/IP/10min, 5/token/10min, 3 falhas consecutivas, bloqueio 30min, processing abandonado 2min).
   - Edge Function `supabase/functions/public-invite-accept/index.ts` + entrada em `supabase/config.toml` com `verify_jwt = false`. Solicitação do secret `INVITE_TOKEN_SECRET` (64 chars) via fluxo de secrets — sem gravar no repo.
   - Migração `_rpc_merge_workers_v1.sql` — assinatura `merge_workers(_primary uuid, _secondary uuid, _confirmation text)`, admin-only, fase de detecção completa antes de qualquer alteração, retorno `{result:"conflict", conflicts:[]}` sem exceção, matriz `payroll_batch_items` restrita a colunas confirmadas, políticas específicas por tabela conforme spec, sem referência a `worker_sst_qualifications`.
5. Criar `.lovable/rollback/entrega-1.md` conforme spec.
6. Rodar `vite build` e `tsgo --noEmit`.

## Não farei nesta entrega

A10, `VALIDATE CONSTRAINT`, mesclagens reais, índices únicos definitivos, qualquer artefato SST, aplicação de `ensure_worker` em formulários, tela `/settings/duplicates`.

## Interrupções previstas

Se uma coluna citada na spec não existir no schema real, interrompo apenas o artefato afetado e registro a divergência no relatório final — sem improvisar estrutura.

## Retorno ao final

Exclusivamente: arquivos criados/alterados, migrations criadas, resultado e contagens do dry-run, riscos, `vite build`, `tsgo --noEmit`, itens aguardando aprovação.
