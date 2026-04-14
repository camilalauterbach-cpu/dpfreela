

## Etapa 4 — Reescrita das telas principais para link_groups

### Ajustes pendentes no hook (pré-requisito)

Dois ajustes no `useLinkGroups.ts` antes das telas:

1. **`useLinkGroupWorkers`**: trocar `.order("created_at", { ascending: false })` por ordenação pelo nome do trabalhador (via join, client-side sort por `workers.full_name`)
2. **Mutations de worker** (`useAllocateWorker`, `useUpdateGroupWorker`, `useRemoveGroupWorker`): adicionar invalidação de `["link-group", vars.link_group_id]` no `onSuccess`

### Tela 1: Links.tsx (listagem)

Substituir o uso de `useEmploymentLinks` por `useLinkGroups`. A tabela passa a listar **grupos**, não vínculos individuais.

Colunas: Nome do grupo, Evento, Empresa, Trabalhadores (count), Período, Status.

Filtros mantidos: busca, status, empresa, evento, período.
Exportações (CSV, PDF, Admissão, ZIP): mantidas mas adaptadas para ler de `link_groups` + `link_group_workers`.
Click na row navega para `/links/:groupId` (detalhe do grupo).
Botao "Novo" navega para `/links/new` (criar grupo).

### Tela 2: LinkForm.tsx (criar/editar grupo)

Formulario de **grupo**, nao de vinculo individual. Campos do grupo:

- `group_name` (obrigatório)
- `event_id` (select, auto-preenche `company_id`)
- `company_id` (select)
- `status`, `hire_date`, `end_date`
- Jornada: `shift_type`, `work_shift`, `work_schedule`, `call_time`, `daily_hours`, `weekly_hours`
- Dias de atuacao: `work_days_mode`, `specific_work_dates`, `work_days_notes`
- Operacional: `supervisor_name`, `assembly_point`, `uniform_notes`, `transport_notes`, `meal_entitlement`
- `required_documents` (config de documentos)
- `notes`

Sem campos de remuneração no grupo (fica no worker individual).
Sem seleção de trabalhador (alocação é feita no detalhe do grupo).
Usa `useCreateLinkGroup` / `useUpdateLinkGroup`.

### Tela 3: LinkDetail.tsx (detalhe do grupo)

Header com nome do grupo, badge de status, evento, empresa.

Tabs:
- **Dados**: cards com informações do grupo (mesma estrutura atual, sem remuneração)
- **Trabalhadores**: lista de `link_group_workers` com nome, função, status. Botão "Alocar trabalhador" abre dialog/inline para adicionar worker ao grupo. Cada worker com ações de editar/remover.
- **Documentos**: mantido, adaptado para usar `link_group_workers` em vez de `employment_links`

Usa `useLinkGroup(id)`, `useLinkGroupWorkers(id)`, `useAllocateWorker`, `useRemoveGroupWorker`.

### Rotas (App.tsx)

Sem alteração de rotas. As rotas `/links`, `/links/new`, `/links/:id`, `/links/:id/edit` continuam existindo, apontando para os mesmos componentes reescritos.

### O que NAO sera feito nesta etapa

- Nenhuma alteração em `EventLinksList`, `WorkerLinksList`, `ImportLinksDialog`, `Dashboard` (etapa 5)
- Nenhuma migração SQL
- Nenhum soft-delete do legado
- `useEmploymentLinks.ts` permanece intacto

### Arquivos alterados

| Arquivo | Acao |
|---|---|
| `src/hooks/useLinkGroups.ts` | Ajustar ordenacao e invalidacao |
| `src/pages/Links.tsx` | Reescrever para listar `link_groups` |
| `src/pages/LinkForm.tsx` | Reescrever para criar/editar grupo |
| `src/pages/LinkDetail.tsx` | Reescrever para detalhe de grupo + tab trabalhadores |

