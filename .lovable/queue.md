# Fila de Entregas

## DONE
- Q-020.A — Reparo transacional da Amanda (vínculo formal + associação).
- Q-020.B — Alocação atômica grupo + vínculo formal (RPCs `allocate_worker_to_group`, `update_group_worker_allocation`, `f_resolve_or_create_allocation_employment_link`, índice único, trigger `f_enforce_allocation_employment_link`).
- Q-020.C — Joins, IDs, tratamento de erro e remoção da heurística de vínculo.
- Q-021.0 — Diagnóstico read-only do Controle SST por escopo/lote (homologado).

## BLOCKED
- Q-021.1..4 — Schema/UI/Integração do Controle SST por escopo/lote (aguardam Q-023 Fases 3-5).
- Q-020.D — Backfill global e promoção estrutural (NOT NULL).
- Q-022 — Precedência canônica de requisitos (cargo + evento + overrides add/waive).
- Q-014.2 — Follow-up de validade.

## VALIDATING
- Q-022.A / Q-023 Fases 1-5 — Resolvedor canônico de contextos + requisitos, requisito global de ASO, Painel de Qualificações v2 com estado "Contexto pendente".

## IN_PROGRESS
- Q-023 Fase 5 (avançada) — Filtros de Evento/Grupo/Cargo no Painel, célula de duas dimensões (borda de exigência), exportação enriquecida.
- Q-021.1 — Schema `sst_control_scopes` + RPCs (bloqueado até homologação de Fases 1-5).

## PAUSED
- Q-014.1-CLOSEOUT — Pausada pelo P0 (Q-020). Não desfazer.
