# Auditoria — Independência entre Pessoa e Vínculo (banco mestre)

Data: 2026-07-26 · Escopo: workers, employment_links, link_group_workers,
worker_sst_qualifications, worker_documents.

## Regra de negócio

A pessoa/trabalhador existe no banco por si só. Pode ter **zero, um ou vários**
vínculos simultâneos ou históricos. Estar sem vínculo NÃO é pendência, erro,
incompletude, órfão, nem motivo para exigir cargo/role.

## Achados do modelo (SQL)

### FKs que referenciam `public.workers`

| Origem | on_delete | Efeito |
| --- | --- | --- |
| `employment_links.worker_id` | CASCADE | Apagar worker apaga vínculos (direção segura). |
| `link_group_workers.worker_id` | NO ACTION | Encerrar/apagar vínculo NÃO toca worker. ✅ |
| `worker_sst_qualifications.worker_id` | RESTRICT | Impede excluir worker enquanto houver qualificações — protege dossiê. ✅ |
| `worker_documents.worker_id` | CASCADE | Somente worker→documento (não o inverso). |
| `worker_dependents`, `worker_payment_methods`, `employment_link_documents`, `document_compliance_history`, `payroll_batch_items` | CASCADE | Todos direção worker→filho. |

**Conclusão:** nenhum FK propaga remoção de vínculo para a pessoa nem apaga
documentos/qualificações quando um vínculo é excluído.

### Triggers

- `trg_assert_completion_employment_links` / `trg_assert_completion_link_group_workers`
  — disparam apenas quando o vínculo passa a `status='active'`. Bloqueiam
  ativação de vínculo se documentos obrigatórios estão pendentes, mas **não
  bloqueiam salvar a pessoa** nem exigem que uma pessoa tenha vínculo.
- `trg_worker_documents_block_sst_nr` — impede uso de tipos NR em
  `worker_documents`; independente de vínculo.
- Nenhum trigger propaga remoção de vínculo para worker/documentos.

## UX/Frontend — ajustes aplicados

1. `src/pages/SstPendencies.tsx`
   - Rótulo alterado: **"Sem vínculo ativo"** → **"Disponível — sem vínculo atual"**.
   - Header renomeado de "Vínculos:" para "Vínculo atual:" (contexto informativo, sem cor de alerta).
   - Contagem de "pendências" já não incluía ausência de vínculo — nenhuma mudança na lógica de `collectPendencies`.
2. `src/hooks/useWorkers.ts`
   - Novo filtro opcional `linkStatus`: `""` (todos, padrão), `"available"`, `"linked"`.
3. `src/pages/Workers.tsx`
   - Combobox informativo "Vínculo atual" no painel de filtros. Sem exclusão de nenhum grupo por padrão.
4. `src/lib/sst/pendencies-export.ts`
   - Nova coluna "Vínculo atual (informativo)" na aba **Pendências SST**.
   - Pessoas sem vínculo recebem rótulo neutro "Disponível — sem vínculo atual" — nunca ação obrigatória.
   - Aba **Órfãos e legados** continua estritamente FK quebrada / worker excluído / document_type ausente.

## Órfão — definição canônica (mantida)

`useSstQualifications.ts` classifica órfão apenas em três situações:
- `worker_not_found` — worker_id não existe.
- `worker_deleted` — worker com `deleted_at`.
- `missing_document_type` — qualificação sem `document_type_id` canônico.

Pessoa ativa sem vínculo **nunca** é classificada como órfã.

## Cobertura de cenários

| # | Cenário | Estado |
| --- | --- | --- |
| A | Worker sem vínculo permanece ativo, pesquisável e não órfão | ✅ (nenhum código o exclui) |
| B | Worker com N vínculos aparece 1 vez na listagem | ✅ (query em `workers`, join só quando filtrado) |
| C | Encerrar último vínculo preserva worker, docs, NRs, histórico | ✅ (FKs/triggers auditados) |
| D | Pessoa sem vínculo não recebe pendência por esse motivo | ✅ (rótulo neutro; export idem) |
| E | Qualificação válida de pessoa sem vínculo continua válida | ✅ (view `worker_sst_qualifications_current` não filtra por vínculo) |
| F | Órfão exige worker ausente/quebrado, não ausência de vínculo | ✅ (regra em `useSstQualifications`) |
| G | Exportação não conta "sem vínculo" como pendência | ✅ (coluna informativa) |
| H | Criar novo vínculo reutiliza worker existente e não duplica pessoa | ✅ (fluxo de alocação já usa `worker_id` existente) |
| I | Completar documentos é independente de criar vínculo | ✅ (upload em `worker_documents` não exige link) |
| J | Fixtures E2E continuam isoladas | ✅ (`isTestDataWorker`) |

## Nenhuma migration executada

O modelo já respeita a regra "worker 1 → 0..N vínculos". As mudanças desta
entrega são **exclusivamente UX/rótulos e um filtro informativo**.