# Fila de Entregas

## DONE
- Q-020.A — Reparo transacional da Amanda (vínculo formal + associação).
- Q-020.B — Alocação atômica grupo + vínculo formal (RPCs `allocate_worker_to_group`, `update_group_worker_allocation`, `f_resolve_or_create_allocation_employment_link`, índice único, trigger `f_enforce_allocation_employment_link`).
- Q-020.C — Joins, IDs, tratamento de erro e remoção da heurística de vínculo.
- Q-021.0 — Diagnóstico read-only do Controle SST por escopo/lote (homologado).
- Q-022.A-HOTFIX-ASO — CLOSEOUT: baseline operacional 59/56 homologada (Opção A). Predicado operacional preservado; eventos `completed` permanecem históricos.

## BLOCKED
- Q-021.1..4 — Schema/UI/Integração do Controle SST por escopo/lote (aguardam Q-023 Fases 3-5).
- Q-020.D — Backfill global e promoção estrutural (NOT NULL).
- Q-022 — Precedência canônica de requisitos (cargo + evento + overrides add/waive).
- Q-014.2 — Follow-up de validade.

## VALIDATING
- Q-022.A — Precedência canônica de requisitos (permanece VALIDATING enquanto Q-016 mantiver input livre de NR).
- Q-023 core — VALIDATING_WITH_Q016_OPEN (Fases 1-5 aprovadas com baseline 59/56; encerramento integral aguarda Q-016).

## IN_PROGRESS
- Q-023 Fase 5 (avançada) — Filtros de Evento/Grupo/Cargo no Painel, célula de duas dimensões (borda de exigência), exportação enriquecida.
- Q-016 — Catálogo canônico de qualificações por `document_type_id` (bloqueia encerramento de Q-023 core).

## VALIDATING
- Q-024-D-UI-MULTIPLE — Ficha do trabalhador permite múltiplas qualificações vigentes:
  - `SstQualificationsPanel`: toolbar permanente "Adicionar qualificação" (sempre visível para admin/manager/operator, com 0/1/N linhas). Empty state atualizado para "Nenhuma qualificação registrada".
  - `SstCertificateDrawer`: input livre de NR removido. Passa a consumir `useWorkerQualificationTypes({ includeInactive: false })` via novo `QualificationDocumentTypeCombobox` (busca por código/nome, sem criação inline, sem inativos).
  - Payload envia `document_type_id` (identidade canônica Q-024.B) + `nr_code` legado; `expected_current_qualification_id` em renew/replace.
  - Roteamento por `storageFlow`: `worker_sst_qualifications` prossegue; `worker_documents` (ASO) bloqueia com CTA para aba Documentos; `unresolved` desabilita.
  - Detecção de tipo já vigente em `create`: badge "Já cadastrada" no combobox + alerta com atalhos Renovar/Substituir. Impede duplo current do mesmo `document_type_id`.
  - Botão "Salvar e adicionar outra" limpa o formulário, mantém drawer aberto e permite cadastrar múltiplos tipos em sequência.
  - `presetNrCode` legado resolvido para `document_type_id` via catálogo canônico (compat com `SstPendencies`).
  - Testes unitários (`SstQualificationsPanel.test.tsx`): botão presente com rows = [], [NR18] e [NR18, NR35] — 3/3 verdes. Regressão do defeito coberta.
  - Aguardando E2E autenticado `worker-add-multiple-qualifications-ui.spec.ts` na sessão do admin.

## VALIDATING
- Q-024.B — Identidade canônica `worker_id + document_type_id` em `register_sst_revision`: advisory lock canônico; lookup por UUID; UPDATE `superseded_at` da anterior ANTES do INSERT; entrada compatível (`document_type_id`, `nr_code` legado, ambos verificados); `additional_conflicts_with_current`; apenas `sst_nr`; nenhum tipo criado automaticamente. Aguardando validação E2E autenticada.

## BLOCKED
- Q-024.A-SCOPE = BLOCKED_ADMIN_CLASSIFICATION — 16 tipos elegíveis com `storage_scope` NULL; classificação pelo gate administrativo E-DOC.2.
- Q-024.C, Q-024.D, Q-024.E, Q-024.F, Q-024.G, Q-024.H — BLOCKED enquanto Q-024.A-SCOPE.

## DONE
- Q-024.0-REEVAL — `reevaluate_worker_links` executada com sessão autenticada admin para worker `40ea1d66…`: `links_processed=1`, `transitions_recorded=0`. NR35 vigente permanece `69830e4d…`; `6c7d5b6c…` continua histórico. Nenhuma revisão criada.
- Q-024.A — Catálogo canônico único de tipos elegíveis para qualificação do trabalhador:
  - RPC `public.list_worker_qualification_types(p_include_inactive)` STABLE + SECURITY DEFINER, `auth.uid()` obrigatório, roles `admin/manager/operator/viewer`, `REVOKE` de `PUBLIC` e `anon`, `GRANT EXECUTE` a `authenticated`.
  - Hook único `useWorkerQualificationTypes({ includeInactive })` (`src/hooks/useWorkerQualificationTypes.ts`) com normalizador `normalizeQualificationSearchTerm` compartilhado.
  - `SettingsJobRoles.tsx` refatorado: passa a consumir o hook canônico (`includeInactive=true`); somente tipos ativos+selecionáveis aparecem em "Adicionar documento"; tipos inativos ligados a requisitos históricos são exibidos com marca `(Inativo)`.
  - Predicado anterior (`from("document_types").eq("is_active",true).in("category",["sst_nr","sst_aso","training"])`) removido; sem `as any` no consumidor.
  - Gates de integridade verdes: 0 duplicidades de código normalizado, 0 tipos ativos sem code/name, 0 tipos com registros vigentes simultâneos em `worker_sst_qualifications` e `worker_documents`, 0 tipos ativos com `storage_scope='employment_link'`.
  - `storage_flow` derivado do fluxo real auditado (sst_nr/training → `worker_sst_qualifications`; sst_aso → `worker_documents` — ASO legado 46 registros).
  - Preservado: NR35 reconciliada, índice `uq_worker_sst_current_worker_document_type`, Rock in Rio = 56, vínculo formal da Amanda; nenhum DML operacional executado.
  - E2E scaffold: `e2e/worker-qualification-type-catalog.spec.ts`.
  - TODO(Q-024.D): `SstCertificateDrawer` deve migrar para `useWorkerQualificationTypes({ includeInactive: false })`.
- Q-024.0-DUPLICATE-NR35 — Reconciliação NR-35 do worker `40ea1d66…` por REGRA 1 (explicit supersedes). Prev=`6c7d5b6c` (renewal) → superseded_at=`2026-07-21 14:56:39.46102+00`; Current=`69830e4d` (replacement). Índice `uq_worker_sst_current_worker_document_type` criado. Nenhum arquivo/data alterada; nenhum registro removido.

## PAUSED
- Q-014.1-CLOSEOUT — Pausada pelo P0 (Q-020). Não desfazer.
