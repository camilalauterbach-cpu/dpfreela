# Fila oficial de pendências — DPfreela

Última atualização: Fase 0 + 1.1 aplicadas. Aguardando autorização para Fase 1.2.

| ID | Pendência | Prioridade | Status | Evidência | Bloqueio |
|----|-----------|------------|--------|-----------|----------|
| Q-001 | Crash `insertBefore` em Configurações → Cargos | P0 | IN_PROGRESS | Fase 1.1 aplicada (`translate="no"` em `index.html`). Falta refatoração Fase 1.2 (Dialog em vez de inline rename + mutations fora do DropdownMenu). | Aguarda autorização Fase 1.2 |
| Q-002 | Texto "Cargos" e botão "Novo cargo" habilitado | P0 | VALIDATING | Grep em `src/` não encontra ocorrência de "Cargas" — o label já é "Cargos" em `SettingsPage.tsx:62` e `SettingsJobRoles.tsx:270`. Hipótese confirmada: era tradução automática do Chrome. Bloqueada pelo `translate="no"`. | Precisa validação no preview após deploy |
| Q-003 | Criar/editar/ativar/inativar cargos sem crash | P0 | IN_PROGRESS | Depende da refatoração Fase 1.2. | Aguarda autorização |
| Q-004 | Higiene de cargos: classificação de órfãos/fantasmas | P0 | OPEN | Relatório atual em `SettingsJobRolesHygiene` — revisão prevista Fase 2. | — |
| Q-005 | Preservar 56 RIR + 29 Shakira | P0 | VALIDATING | Snapshot Fase 0: RIR=56 not-deleted (57 total), Shakira=29 not-deleted (37 total). Nenhum DML executado. | — |
| Q-006 | Eliminar cargo livre / fonte única | P0 | OPEN | `JobRoleCombobox` já em uso; auditoria completa Fase 2.7. | — |
| Q-007 | Lotes no Controle SST (`sst_control_batches`) | P1 | OPEN | Fase 3 — migration + UI + hooks. | Bloqueada por P0 |
| Q-008 | Estados/filtros SST compreensíveis | P1 | OPEN | Fase 3.4/3.5. | Bloqueada por P0 |
| Q-009 | Indicador cadastral verde/amarelo/vermelho | P1 | OPEN | Fase 4 — `worker-readiness.ts`. | Bloqueada por P0 |
| Q-010 | Remover "Aptos/Bloqueados" do Dashboard | P1 | OPEN | Fase 5.1 — `DocumentComplianceSection` a substituir. | Bloqueada por P0 |
| Q-011 | Seletor/exportação de Qualificações | P1 | VALIDATING | Aplicado em entrega anterior; falta persistência por `user_id` (5.3) e teste E2E. | — |
| Q-012 | Suíte E2E + CI | P1 | OPEN | Playwright configurado, 0 specs. Fase 6.2/6.4. | — |
| Q-013 | Lint e otimização de chunks grandes | P2 | OPEN | Baseline Fase 0: 376 problemas (351 erros), majoritariamente `no-explicit-any` em `supabase/functions/*` — pré-existentes. | — |

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