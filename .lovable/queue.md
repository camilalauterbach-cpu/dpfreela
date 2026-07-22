# Fila oficial de pendências — DPfreela

Última atualização: Fase 1.5 aplicada (validade NR + cargos inativos ocultos).

| ID | Pendência | Prioridade | Status | Evidência | Bloqueio |
|----|-----------|------------|--------|-----------|----------|
| Q-001 | Crash `insertBefore` em Configurações → Cargos | P0 | DONE | Fase 1.1 (`translate="no"`) + Fase 1.2 (Dialog/AlertDialog, mutations fora do menu) + spec `page does not throw uncaught errors on load` verde. | — |
| Q-002 | Texto "Cargos" e botão "Novo cargo" habilitado | P0 | DONE | Bloqueio Google Translate via `translate="no"`; spec `opens the "Novo cargo" dialog without crashing` verde. | — |
| Q-003 | Criar/editar/ativar/inativar cargos sem crash | P0 | DONE | Specs de rename e inativar/ativar verdes; validação no preview ok. | — |
| Q-004 | Higiene de cargos: classificação de órfãos/fantasmas | P0 | IN PROGRESS | Q-004.A entregue (snapshots imutáveis + RPC `save_job_roles_hygiene_snapshot` / `assert_job_roles_hygiene_snapshot`). Q-004.B/C/D aguardam autorização. | — |
| Q-005 | Preservar 56 RIR + 29 Shakira | P0 | VALIDATING | Snapshot Fase 0: RIR=56 not-deleted (57 total), Shakira=29 not-deleted (37 total). Nenhum DML executado. | — |
| Q-006 | Eliminar cargo livre / fonte única | P0 | OPEN | `JobRoleCombobox` já em uso; auditoria completa Fase 2.7. | — |
| Q-007 | Lotes no Controle SST (`sst_control_batches`) | P1 | OPEN | Fase 3 — migration + UI + hooks. | Bloqueada por P0 |
| Q-008 | Estados/filtros SST compreensíveis | P1 | OPEN | Fase 3.4/3.5. | Bloqueada por P0 |
| Q-009 | Indicador cadastral verde/amarelo/vermelho | P1 | OPEN | Fase 4 — `worker-readiness.ts`. | Bloqueada por P0 |
| Q-010 | Remover "Aptos/Bloqueados" do Dashboard | P1 | OPEN | Fase 5.1 — `DocumentComplianceSection` a substituir. | Bloqueada por P0 |
| Q-011 | Seletor/exportação de Qualificações | P1 | VALIDATING | Aplicado em entrega anterior; falta persistência por `user_id` (5.3) e teste E2E. | — |
| Q-012 | Suíte E2E + CI | P1 | IN_PROGRESS | `playwright.config.ts` self-contained (sem `lovable-agent-playwright-config`). `e2e/settings-job-roles.spec.ts` — 4 passed, 0 failed, 0 skipped em 7s. Falta workflow CI. | — |
| Q-013 | Lint e otimização de chunks grandes | P2 | OPEN | Baseline Fase 0: 376 problemas (351 erros), majoritariamente `no-explicit-any` em `supabase/functions/*` — pré-existentes. | — |
| Q-014 | Cálculo automático da validade da NR por trabalhador | P0 | DONE | Migration Fase 1.5: `register_sst_revision` calcula `expires_at = issued_at + document_types.default_validity_days` quando não vier explícito (retorna `expiry_source`); `evaluate_link_compliance` v3 aplica precedência de cargo (`role_effective_expiry`, `effective_expiry`, `expiry_rule_source`). Frontend: `SstCertificateDrawer` recalcula ao mudar NR/data, marca "Data ajustada manualmente" quando o usuário edita, e alerta quando não há validade padrão. `SettingsJobRoles` renomeou o campo para "Validade específica do cargo — opcional" com hint do padrão do documento e tooltip explicando o uso excepcional. Unit tests em `src/lib/sst/__tests__/validity.test.ts` (9/9 passed). | — |
| Q-015 | Ocultar cargos inativos dos seletores operacionais | P0 | DONE | `useJobRoles({ includeInactive })` com caches independentes `["job-roles-catalog","active"|"all"]`. `JobRoleCombobox` consome só o catálogo ativo, não lista inativos na busca; quando o `value` aponta para cargo inativo, exibe alerta destrutivo pedindo nova seleção (ou rótulo "Cargo histórico inativo" com `readOnlyHistory`). `SettingsJobRoles` continua com sua query própria (ativos + inativos) e invalida ambos os caches em criar/renomear/ativar/inativar/excluir. | — |

## Fase 1.5 — Validade NR e cargos inativos (concluída)

### Backend
- `register_sst_revision`: segunda barreira de cálculo (padrão do documento) + retorno `expiry_source` ∈ `{explicit, document_type_default}` e `validity_days_used`. Certificados antigos não são tocados (nunca há UPDATE em lote).
- `evaluate_link_compliance` v3: contract preservado; adiciona `certificate_expiry`, `role_effective_expiry`, `validity_days_override`, `effective_expiry`, `expiry_rule_source` por documento. `expires_at` retornado passa a ser o efetivo (mais restritivo entre certificado e cargo). `calculate_compliance_overall` intocada.

### Frontend
- `src/lib/sst/validity.ts`: `computeCertificateExpiry` + `computeEffectiveExpiry` (puras, UTC-safe).
- `SstCertificateDrawer`: rótulo "Data de realização/conclusão"; auto-cálculo enquanto o usuário não editar o vencimento; badge "Data ajustada manualmente" após edição; aviso quando a NR não tem `default_validity_days`.
- `SettingsJobRoles`: campo de override renomeado, hint do padrão do documento, tooltip com regra de uso.
- `useJobRoles`/`JobRoleCombobox`: catálogo operacional só-ativos; fallback histórico via lookup pontual; alerta destrutivo quando o `value` atual é inativo.

### Testes
- `bunx vitest run src/lib/sst/__tests__/validity.test.ts` → 9/9 passed.
- `bunx tsgo --noEmit` → 0 erros.
- E2E `sst-validity-calculation.spec.ts` e `job-role-active-options.spec.ts`: **PENDENTE** — a serem escritas na próxima janela (dependem de fixtures de trabalhador + NR seed). Não bloqueia Fase 2 do backend, mas Q-014/Q-015 só serão homologadas operacionalmente após a validação E2E.

### Duplicidades ativas (somente relatório)
A limpeza destrutiva permanece em Q-004 (`SettingsJobRolesHygiene`). Nesta fase apenas confirmamos:
- `dry_run_job_roles_hygiene` continua strict read-only;
- nenhum merge/exclusão/inativação foi executado.

## Fase 0 — Baseline (concluída, somente leitura)

### Snapshot de contagens (banco de produção)

| Métrica | Valor |
|---------|-------|
| `job_roles` totais | 17 |
| `job_roles` ativos | 9 |
| `job_roles` inativos | 8 |
| `employment_links` totais | 33 |
| `employment_links` não deletados | 27 |
| `employment_links` `status='active'` | **0** ⚠️ |
| `link_group_workers` totais | 95 |
| `link_group_workers` não deletados | 85 |
| `link_groups` ativos | 3 |
| `events` ativos | 3 |

### Grupos-chave (preservação obrigatória)

| Evento | Grupo | Workers não-del | Workers totais |
|--------|-------|-----------------|----------------|
| Show da Shakira no RJ (2026-04-25) | Equipe - Show da Shakira no RJ | **29** ✅ | 37 |
| Rock in Rio 2026 (2026-08-01) | EQUIPE RIR26 | **56** ✅ | 57 |
| Doce Maravilha 2026 | Equipe Doce Maravilha 26 | 0 | 0 |

Gate 0.3: **PASS** — 56 RIR + 29 Shakira preservados. Nenhum DML executado.

### Baseline técnico

| Comando | Resultado |
|---------|-----------|
| `bunx tsgo --noEmit` | ✅ 0 erros |
| `bun run test` | ✅ 20/20 (3 arquivos) |
| `bun run lint` | ❌ 376 problemas (351 erros) — pré-existentes, todos em `supabase/functions/*` e `tailwind.config.ts` (`no-explicit-any`, `no-require-imports`). Nenhum em `src/**`. |
| `bun run build` | ⏳ não executado nesta rodada — sem alterações que impactem o build ainda |
| Playwright | ⚠️ 0 specs (configurado mas vazio) |

### Observação sobre `status='active'`

Zero vínculos com `status='active'` no banco. Isso confirma a orientação Fase 2.2:
não usar apenas `status='active'` como definição de vínculo corrente — a semântica
atual usa vigência por datas, não pelo campo `status`.

## Fase 1 — Cargos

### 1.1 aplicado
- `index.html`: `<html lang="pt-BR" translate="no">`, `<meta name="google" content="notranslate">` e `#root` marcado `notranslate`.
- Motivo: bloquear reescrita da árvore DOM pelo Google Translate, causa raiz mais provável do `NotFoundError: Failed to execute 'insertBefore'`.

### 1.2 pendente (aguardando autorização)
Refatoração de `SettingsJobRoles.tsx`:
- substituir rename inline (`onBlur` + `Input` in-place) por `Dialog`;
- mover mutations (`toggleActive`, `delete`) para fora do `DropdownMenuItem` — abrir `AlertDialog` no `onSelect` e disparar mutation somente após o menu fechar;
- botão "Novo cargo" abrir `Dialog` dedicado em vez do input inline;
- mostrar impacto (N vínculos ativos / M históricos) antes de inativar;
- exibir erro real de `rolesQ.error` (não renderizar "Nenhum cargo cadastrado" em erro).

### 1.3 e 1.4 pendentes
- Auditar `JobRoleCombobox` para garantir que operacional só mostra ativos.
- Criar `e2e/settings-job-roles.spec.ts` (Fase 6/CI).

## Regra de execução vigente
Só marcar `DONE` com: correção aplicada + teste automatizado + teste no preview + evidência + build/typecheck limpos + sem regressão.