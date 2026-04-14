

## Etapa 3 — Execução: Hook `useLinkGroups.ts`

Criar o arquivo `src/hooks/useLinkGroups.ts` seguindo o padrão exato de `useEmploymentLinks.ts`.

### Arquivo a criar

**`src/hooks/useLinkGroups.ts`** — um único arquivo com:

#### Queries

1. **`useLinkGroups(search, statusFilter)`** — select de `link_groups` com joins `events(name)`, `companies(legal_name, trade_name)`. Busca client-side por `group_name` e `events.name` (mesmo padrão do legado). Filtro por status. Limit 200. `events.name` acessível via cast `(g.events as any)?.name`.

2. **`useLinkGroup(id)`** — select `*` com joins `events(id, name, requires_epi_form, requires_service_order, required_nrs, required_nrs_other)`, `companies(legal_name, trade_name)`. Usa `.single()`.

3. **`useLinkGroupWorkers(groupId)`** — select de `link_group_workers` por `link_group_id`, com join `workers(full_name, nickname, cpf, phone_main)`. `deleted_at IS NULL`. Ordenado por `created_at desc`.

4. **`useLinkGroupsByEvent(eventId)`** — select de `link_groups` por `event_id`, `deleted_at IS NULL`. Inclui contagem de workers ativos via query separada (select count de `link_group_workers` com `deleted_at IS NULL` filtrado pelo grupo).

#### Mutations

5. **`useCreateLinkGroup()`** — insert em `link_groups`, invalida `["link-groups"]`.

6. **`useUpdateLinkGroup()`** — update em `link_groups` por id, invalida `["link-groups"]`, `["link-group", id]`, `["link-groups-event"]`.

7. **`useAllocateWorker()`** — insert em `link_group_workers` com todos os campos individuais. Invalida `["link-group-workers", groupId]`, `["link-groups"]`, `["link-groups-event"]`.

8. **`useUpdateGroupWorker()`** — update em `link_group_workers` por id. Mesmas invalidações.

9. **`useRemoveGroupWorker()`** — soft-delete (`deleted_at = now()`). Mesmas invalidações.

### Validação pós-execução

Após criar o arquivo, rodar queries de teste via Supabase para confirmar que os dados do grupo Shakira e seus 27 trabalhadores são retornados corretamente pelas queries definidas.

### O que NÃO será feito

- Nenhuma alteração em telas/componentes
- Nenhuma alteração em `useEmploymentLinks.ts`
- Nenhuma migração SQL

