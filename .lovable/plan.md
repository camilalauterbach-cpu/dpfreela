## E-ADMIN.2 — Remoção definitiva de Cargo/Função livre + Consolidação da fonte única (APROVADA)

Fecha o ciclo de `job_roles` como entidade mestre. Ao final: todo vínculo/alocação exige `job_role_id`; nenhuma tela aceita cargo digitado; toda leitura vem de `job_roles` + `evaluate_link_compliance`. Backfill **nunca autocria cargos**.

### 1. Backend — reconciliação sem autocriação

**Passo 1 · Migration de reconciliação (dry-run + gate)** — cria `job_role_backfill_unmatched`, popula com toda linha sem match normalizado, e se houver linhas `RAISE EXCEPTION` com contagem + 10 amostras. Nada muda no banco.

**Passo 2 · Migration estrutural (só passa com gate vazio)** — adiciona `link_group_workers.job_role_id UUID FK`, backfill exato normalizado, reexecuta gate, `SET NOT NULL` em ambas as tabelas, índice.

**Passo 3 · Trigger `f_enforce_link_job_role()`** compartilhada com mensagens PT distintas: nulo, inexistente/soft-deleted, inativo.

**Passo 4 · `job_role` texto** vira read-only (rollback/export). Sem sync.

### 2. Frontend — Combobox único

`JobRoleCombobox.tsx` (Command+Popover), fonte `job_roles` staleTime 2min, ativos selecionáveis, inativos cinza `(Inativo)` desabilitados. Empty state com CTA para `/settings?tab=job-roles`. Sem criação inline.

Substituir em `LinkDetail.tsx` (Alocar) e `AllocationEditForm.tsx`. Adicionar join `job_roles:job_role_id(name, is_active)` em: `useEmploymentLinks`, `useLinkGroups`, `usePayroll`, `WorkerLinksList`, `LinkWorkerDetail`, `PayrollDetail`, `PayrollItemForm`, `ImportLinksDialog`, e exports.

### 3. Consolidação da fonte única

**Cadeia canônica:** `job_roles → employment_links.job_role_id → link_group_workers.job_role_id → evaluate_link_compliance → list_link_compliance → UI`.

**`nao_configurado` — decidido por CONFIGURAÇÃO DO CARGO, não por matriz efetiva** (short-circuit em `evaluate_link_compliance`, ANTES do motor):

```text
v_role_configured := EXISTS (
  SELECT 1 FROM job_role_document_requirements
  WHERE job_role_id = link.job_role_id AND is_active
);
v_effective_required := resolveRequiredDocuments(link);

IF NOT v_role_configured AND cardinality(v_effective_required) = 0 THEN
  overall := 'nao_configurado';
ELSE
  overall := calculate_compliance_overall(v_effective_required);
END IF;
```

`calculate_compliance_overall` permanece **pura e IMMUTABLE**. Vínculo com cargo configurado mas totalmente dispensado por override/waiver segue `apto`. Estrutura extensível: futuras origens (evento/empresa/template) apenas enriquecem `v_role_configured` sem tocar o motor.

Contrato `ComplianceOverall` ganha `'nao_configurado'` (label "Cargo sem requisitos", tom `warning`). `ComplianceBadge` e agregados renderizam o estado.

**`list_link_compliance`** apenas agrega — loop chamando `evaluate_link_compliance`, zero cálculo próprio.

**Status Shakira ("Rascunho")** — corrigir toda leitura para `employment_links.status`, nunca `link_groups.status`.

### 4. Critérios de aceite

- Nenhum input de Cargo/Função editável em telas operacionais.
- `link_group_workers.job_role_id` e `employment_links.job_role_id` `NOT NULL`.
- Trigger com mensagens PT distintas.
- Combobox único; inativos visíveis não selecionáveis; CTA no empty.
- `bun run build` limpo.
- **Auditoria backend (leituras):** `rg "\.job_role[^_]"` em `src/` = 0 em código de negócio (fora de blocos legado/export marcados).
- **Auditoria frontend (escritas):** `rg "job_role_id"` — confirmar que toda gravação usa UUID.
- Nenhum "Apto" sem `evaluate_link_compliance` retornar `apto`.
- Cargos não configurados → `nao_configurado`; cargos configurados com override total → `apto`.
- `list_link_compliance` só agrega (verificado no corpo da RPC).
- Cargos vêm exclusivamente de `job_roles.name`.
- Status de vínculo vem de `employment_links.status` (caso Shakira).
- **Checks pós-deploy (obrigatórios, mesmo com NOT NULL):**
  ```sql
  SELECT COUNT(*) FROM link_group_workers WHERE job_role_id IS NULL;  -- = 0
  SELECT COUNT(*) FROM employment_links   WHERE job_role_id IS NULL;  -- = 0
  SELECT DISTINCT job_role FROM employment_links
  UNION
  SELECT DISTINCT job_role FROM link_group_workers;  -- só legado
  ```

### 5. Detalhes técnicos

- Normalização: `regexp_replace(lower(unaccent(trim(coalesce(x,'')))), '\s+', ' ', 'g')`.
- Slug: `regexp_replace(lower(unaccent(name)), '[^a-z0-9]+', '_', 'g')`.
- Trigger única `f_enforce_link_job_role()` via `TG_TABLE_NAME`.
- `useLinkCompliance` mantém `staleTime: 30s`.

### Fora de escopo

- Remoção física da coluna `job_role` texto (release futura).
- **E-ADMIN.3** — ferramenta de merge assistido de cargos duplicados.

## E-DOC.2 · TODOs registrados (pós-aprovação da UI do gate)

- **Passo 2 (obrigatório):** substituir o JOIN por código em `document_type_usage_counts()`
  (`dt.code = eld.document_type`) por FK direta `eld.document_type_id = dt.id`
  após adicionar `employment_link_documents.document_type_id` na migração estrutural.
- **Passo 2 (revisões imutáveis):** ao introduzir `is_current` / `supersedes_id` /
  `superseded_at`, atualizar `document_type_usage_counts()` para filtrar
  `AND is_current = true` em `worker_documents` e (quando existir) em
  `employment_link_documents`. Contagem `DISTINCT worker_id` / `DISTINCT employment_link_id`
  permanece — mede impacto de classificação, não volume de arquivos.
- **Escopo mantido enxuto:** não incluir `document_count` agora. Métricas de
  auditoria documental (vigentes/revisões/históricos) ficam para RPC dedicada
  quando a tela de auditoria existir.
- **Futuro `storage_scope = 'company'`:** registrado como evolução, fora do escopo atual.

## E-DOC.2 · Invariantes arquiteturais (autorização condicional do Passo 2)

Autorização: **Passo 2 liberado** assim que `document_type_scope_gate_status().ready_for_step_2 = true`.

Invariantes obrigatórias — protegidas por trigger/RPC no Passo 2:

1. **Conformidade nunca lê documentos diretamente.** UI e módulos consomem
   exclusivamente `evaluate_link_compliance()` → `list_link_compliance()`.
   Leitura direta de `worker_documents` / `employment_link_documents` para
   fins de compliance é proibida.
2. **RPCs de revisão são o único ponto de escrita.** Após o Passo 2,
   `INSERT`/`UPDATE` direto em `worker_documents` e `employment_link_documents`
   é bloqueado por trigger. Todo caminho de escrita (UI, import, edge functions)
   passa por `register_worker_document_revision()` / `register_link_document_revision()`.
3. **Histórico imutável.** Trigger `BEFORE UPDATE` bloqueia qualquer alteração
   quando `is_current = false`. Revisões antigas são somente leitura/download.
4. **`storage_scope` faz parte da identidade do tipo documental.** Alteração
   permanece condicionada a `p_force = true` e é tratada como praticamente
   equivalente a criar um novo tipo (owner, revision strategy e compliance derivam dele).

Sequência de execução do Passo 2 (fixada):

1. Concluir a classificação dos 32 `document_types` pela UI do gate.
2. Confirmar `ready_for_step_2 = true`.
3. Modelo de revisões imutáveis: `supersedes_id`, `superseded_at`, `is_current`
   + CHECK `(superseded_at IS NULL OR supersedes_id IS NOT NULL)`.
4. RPCs `register_worker_document_revision` / `register_link_document_revision`
   como ponto único de escrita.
5. Triggers de enforcement de `storage_scope` (bloqueio de upload no nível errado)
   e de imutabilidade do histórico.
6. Atualizar `document_type_usage_counts()` para FK `document_type_id` e filtro
   `is_current = true`.
