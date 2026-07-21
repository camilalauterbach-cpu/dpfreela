## E-SST.1A — Modelo, arquivos, backfill e bloqueio de duplicidade (congelada)

Execução em **4 fases** com portões objetivos. Nenhum estado intermediário no banco. **Especificação congelada:** durante a implementação, não incorporar melhorias, não alterar escopo, registrar novas ideias apenas como débito técnico para E-SST.1B em diante.

### Regra de execução do agente (aplica a todas as fases)

- Nunca entrar em ciclo de tentativa e erro.
- **Máximo 2 tentativas** de correção para o mesmo erro.
- Persistindo, **interromper imediatamente** e reportar em uma única mensagem: causa provável · objeto afetado · SQL ou stack trace · proposta objetiva de correção.
- Enquanto houver falha aberta, não implementar outras fases nem tocar em código fora do escopo da correção.

### Infra transversal (criada na Fase 1, usada por todas)

- `migration_execution_log(id, migration_name text, phase text, executed_at timestamptz default now(), success boolean, environment text, git_revision text, executed_by text, notes text)` — registro por fase; `environment` lido de `current_setting('app.deploy_environment', true)`, `git_revision` de `current_setting('app.git_revision', true)`, `executed_by` de `coalesce(auth.uid()::text, current_user)`.
- `sst_migration_audit(id, migration_name text, started_at timestamptz, finished_at timestamptz, success boolean, worker_documents_migrated int, employment_link_documents_migrated int, history_updated int, unmatched int, duration_ms int)` — `success` inicia `NULL` no `INSERT` de abertura; vira `true` no `UPDATE` final antes do COMMIT. Rollback descarta a linha (não persiste), garantindo consulta clara depois.
- `sst_migration_unmatched(id, source_table, source_id, worker_id, nr_code, reason, created_at)`.

Toda fase encerra com:
```sql
INSERT INTO migration_execution_log(migration_name, phase, success, environment, git_revision, executed_by)
VALUES ('E-SST.1A', '<Phase N>', true,
        current_setting('app.deploy_environment', true),
        current_setting('app.git_revision', true),
        coalesce(auth.uid()::text, current_user));
```
Em caso de `RAISE EXCEPTION`/`ROLLBACK`, o insert não persiste — a ausência do registro é o próprio sinal.

### Fase 1 — Schema (sem backfill, sem restrições finais)

Migration #1, estrutural, idempotente.

1. `worker_sst_qualifications`:
   - `document_type_id uuid NULL REFERENCES public.document_types(id)` (promoção a NOT NULL só na Fase 3).
   - Trigger `AFTER INSERT/UPDATE OF document_type_id`: se não nulo, exige `document_types.category = 'sst_nr'`.
   - Evidência: `certificate_file_path text`, `certificate_file_name text`, `certificate_mime_type text`, `certificate_uploaded_at timestamptz`.
   - Rastreio legado: `legacy_worker_document_id uuid NULL`, `legacy_employment_link_document_id uuid NULL`.
2. Enum `sst_revision_reason` (`created`, `renewed`, `replaced`, `revoked`, `corrected`, `expired`, `migrated`) + coluna `revision_reason sst_revision_reason NULL`; view `_history` propaga o campo.
3. Índices parciais em ativos:
   - `idx_sst_qual_worker_type_current(worker_id, document_type_id) WHERE deleted_at IS NULL AND is_current`.
   - `uq_sst_qual_worker_type_issued_active(worker_id, document_type_id, issued_at) WHERE deleted_at IS NULL`.
   - `idx_sst_qual_expires_at(expires_at) WHERE deleted_at IS NULL AND is_current`.
4. Trigger `worker_documents_block_sst_nr` **criada mas não anexada** (só na Fase 3). ASO segue livre.
5. Tabelas transversais acima (`migration_execution_log`, `sst_migration_audit`, `sst_migration_unmatched`).
6. GRANT / RLS conforme padrão.

**Portão Fase 1 → 2:** `bun run build` limpo · `tsgo` limpo · `supabase--linter` sem novos criticals · contagem de qualificações inalterada · registro `('E-SST.1A','Phase 1', true)` presente.

### Fase 2 — Backfill (transação única, ROLLBACK obrigatório em qualquer falha)

Migration #2, transação única, idempotente.

Abertura da transação:
```sql
SET LOCAL app.allow_legacy_sst_write = 'true';
SELECT pg_advisory_xact_lock(hashtext('E-SST.1A_BACKFILL'));  -- serializa execuções concorrentes
INSERT INTO sst_migration_audit(migration_name, started_at, success)
     VALUES ('E-SST.1A', now(), NULL) RETURNING id INTO v_audit_id;
```

Passos (`ON CONFLICT DO NOTHING`; `UPDATE ... WHERE certificate_file_path IS NULL`):
1. Resolver `document_type_id` em qualificações existentes via `document_types.code = nr_code`; sem match → grava em `sst_migration_unmatched`.
2. `worker_documents` `sst_nr` ativos sem qualificação → cria qualificação (`revision_reason='migrated'`), copia arquivo/metadados para `certificate_*`, preenche `legacy_worker_document_id`.
3. Idem para `employment_link_documents` `sst_nr` → `legacy_employment_link_document_id`.
4. Reclassifica `revision_reason` histórico por heurística conservadora; default `migrated`.

**Bloco de validação final DENTRO da mesma transação**, antes do COMMIT. Qualquer violação → `RAISE EXCEPTION` → `ROLLBACK` automático → **nenhuma alteração parcial permanece no banco**. Sem gate humano intermediário.

Contagens obrigatoriamente = 0:
- qualificações sem `document_type_id` restantes;
- linhas em `sst_migration_unmatched`;
- `sst_nr` órfãos em `worker_documents` sem par;
- `sst_nr` órfãos em `employment_link_documents` sem par;
- violações dos índices únicos da Fase 1;
- qualificações criadas a partir de arquivo legado onde `certificate_file_path` seja `NULL`, string vazia, ou apenas espaços (`btrim(certificate_file_path) = ''`). Verificação de existência no storage é registrada como débito futuro (`E-SST.1A/F2/storage-probe`).

Contagem exigida = antes: `sst_aso` (intocado).

Encerramento da transação:
```sql
UPDATE sst_migration_audit
   SET finished_at = now(),
       success = true,
       worker_documents_migrated = v_wd,
       employment_link_documents_migrated = v_eld,
       history_updated = v_hist,
       unmatched = 0,
       duration_ms = EXTRACT(MILLISECONDS FROM (now() - v_started))::int
 WHERE id = v_audit_id;
INSERT INTO migration_execution_log(migration_name, phase, success, environment, git_revision, executed_by)
VALUES ('E-SST.1A', 'Phase 2', true,
        current_setting('app.deploy_environment', true),
        current_setting('app.git_revision', true),
        coalesce(auth.uid()::text, current_user));
```

### Fase 3 — Restrições finais

Migration #3, transação única, só após Fase 2 committed.

1. **Pré-verificação explícita** (nunca depender só do erro do PostgreSQL), antes do `ALTER`:
   ```sql
   DO $$
   DECLARE v_null_count int;
   BEGIN
     SELECT COUNT(*) INTO v_null_count
       FROM public.worker_sst_qualifications
      WHERE document_type_id IS NULL;
     IF v_null_count <> 0 THEN
       RAISE EXCEPTION
         'E-SST.1A/F3: % qualificações sem document_type_id — abortando promoção a NOT NULL',
         v_null_count;
     END IF;
   END $$;
   ```
2. `ALTER TABLE worker_sst_qualifications ALTER COLUMN document_type_id SET NOT NULL`.
3. Anexar trigger `worker_documents_block_sst_nr` `BEFORE INSERT/UPDATE`: rejeita linha cujo `document_type_id` seja `sst_nr`, salvo `current_setting('app.allow_legacy_sst_write', true) = 'true'`. ASO permanece permitido.
4. Revalidar na mesma transação: sem `sst_nr` novo em `worker_documents`; toda qualificação com `document_type_id`; índices únicos válidos; ASO intocado. Falha → `RAISE EXCEPTION` → `ROLLBACK`.
5. Encerramento: insert padrão em `migration_execution_log` para `'Phase 3'`.

### Fase 4 — Regressão, idempotência e conclusão

1. `bun run build` + `tsgo` limpos.
2. Testes funcionais:
   - `INSERT sst_nr` em `worker_documents` sem flag → erro esperado;
   - `INSERT sst_aso` em `worker_documents` → sucesso;
   - `register_sst_revision` ponta a ponta;
   - duas revisões concorrentes da mesma NR (mesmo `worker_id`+`document_type_id`+`issued_at`) → uma vence, sem duplicata;
   - `register_sst_revision` grava `revision_reason` correto por caminho.
3. **Teste de idempotência do conjunto completo com checksum determinístico** (ordenação explícita, sem depender do plano de execução):
   ```sql
   SELECT md5(string_agg(rec, ',')) FROM (
     SELECT
       id::text || '|' || coalesce(document_type_id::text,'') || '|'
       || coalesce(certificate_file_path,'') || '|'
       || coalesce(revision_reason::text,'') AS rec
     FROM public.worker_sst_qualifications
     ORDER BY worker_id, document_type_id, issued_at, id
   ) t;
   ```
   - antes → `checksum_before`; reexecutar Migration #1 + #2 + #3 sobre a base já migrada; depois → `checksum_after`.
   - Requisitos: `checksum_before = checksum_after` · 0 alterações estruturais · 0 registros alterados · 0 erros · 0 novos itens em `sst_migration_unmatched` · nova linha em `sst_migration_audit` aceita apenas com contadores = 0 e `success=true`.
4. Rollback documentado em `.lovable/rollback/entrega-sst-1a.md` e testado em cópia limpa: desanexa trigger, reverte `NOT NULL`, dropa índices, dropa colunas de evidência/legado, dropa enum, remove entradas de `migration_execution_log`/`sst_migration_audit` correspondentes, restaura estado anterior.
5. Encerramento: insert padrão em `migration_execution_log` para `'Phase 4'` + resumo técnico com contagens de `sst_migration_audit`, portões atendidos, checksums e testes.

**Critério de conclusão (todos simultâneos):** 4 linhas em `migration_execution_log` para `'E-SST.1A'` (Phases 1-4, `success=true`, com `environment`/`git_revision`/`executed_by` preenchidos) · linha correspondente em `sst_migration_audit` com `finished_at` preenchido e `success=true` · rollback validado · build/typecheck limpos · testes previstos executados · checksum estável · zero regressões conhecidas · resumo técnico produzido. Ausência de qualquer item mantém a entrega em andamento.

### Fora do escopo (sequência já aprovada)

E-SST.1B (motor unificado + `calculate_compliance_overall` + `reason_params` + `required_by_sources`) · E-SST.3 (Controle SST com `list_sst_pendencies` incluindo `affected_links`/`affected_events`) · E-SST.2 (aba "NRs e Certificações" no perfil, ordem `Dados → Documentos → NRs → Pagamento → Vínculos`) · E-SST.4 (filtros) · E-SST.5 (depreciação do legado) · E-SST.6 (hardening).

Débitos futuros registrados: Qualification Templates por cargo · Templates de documentos por tipo de evento · Múltiplos cargos com vigência · Origem `company` em `required_by` · Verificação de existência do arquivo no storage durante o backfill (`E-SST.1A/F2/storage-probe`).