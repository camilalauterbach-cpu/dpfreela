# Fila de Entregas

## DONE
- Q-020.A — Reparo transacional da Amanda (vínculo formal + associação).
- Q-020.B — Alocação atômica grupo + vínculo formal (RPCs `allocate_worker_to_group`, `update_group_worker_allocation`, `f_resolve_or_create_allocation_employment_link`, índice único, trigger `f_enforce_allocation_employment_link`).
- Q-020.C — Joins, IDs, tratamento de erro e remoção da heurística de vínculo.

## BLOCKED
- Q-020.D — Backfill global e promoção estrutural (NOT NULL).
- Q-021 — Controle SST por escopo/lote (evento/grupo/manual, membros efetivos, arquivamento).
- Q-022 — Precedência canônica de requisitos (cargo + evento + overrides add/waive, atribuição por origem).

## PAUSED
- Q-014.1-CLOSEOUT — Pausada pelo P0 (Q-020). Não desfazer.
