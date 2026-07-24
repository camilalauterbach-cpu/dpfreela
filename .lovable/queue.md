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

## PAUSED
- Q-014.1-CLOSEOUT — Pausada pelo P0 (Q-020). Não desfazer.
