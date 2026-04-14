

## Implementação: 3 correções funcionais + modelagem contratação/remuneração

### 1. Migração SQL

**`link_groups`**: adicionar `allowed_contract_types text not null default 'both'`

**`link_group_workers`**: adicionar 7 colunas:
- `shift_type text`, `work_shift text`, `work_schedule text`, `call_time time`, `daily_hours numeric`, `weekly_hours numeric`
- `category_reference_rate numeric`

Nenhuma coluna existente removida. Dados dos 27 trabalhadores intactos.

### 2. `src/pages/LinkForm.tsx`

- **Adicionar** select `allowed_contract_types` na seção Contrato (CLT / Prestação de serviço / Ambos)
- **Remover** seção Jornada inteira (linhas 336-365) — turno, escala, horário passam para o trabalhador
- Remover campos de jornada do state/payload, adicionar `allowed_contract_types`

### 3. `src/pages/LinkDetail.tsx`

**Tab Dados**:
- Remover card Jornada (linhas 191-201)
- Adicionar "Tipo de contratação permitido" no card Contrato

**Dialog de alocação** — expandir com seções completas:
- **Identificação**: trabalhador, função/cargo, atividade, departamento, tipo de contrato (filtrado por `allowed_contract_types` do grupo: `clt` → só CLT, `service` → só prestação, `both` → ambas)
- **Jornada**: turno, escala, horário, horário de chamada, horas diárias, horas semanais
- **Remuneração**: tipo de remuneração (cachê/diária/hora/fixo) + valor efetivo do evento (campos separados e claros)
- **Referência**: valor de referência da categoria/cargo (campo `category_reference_rate`, separado do efetivo)
- **Benefícios**: VT (toggle + valor), VR/VA (toggle + valor)
- **Observações**

**Remoção de trabalhador**: substituir `confirm()` nativo por `DeleteConfirmDialog`

### 4. `src/components/links/EventLinksList.tsx`

Reescrever para usar `useLinkGroupsByEvent(eventId)`:
- Cards listam **grupos** (nome, worker_count, status)
- Click navega para `/links/{group.id}`
- Botão "Novo grupo" navega para `/links/new?event={eventId}`
- Remover imports/queries de `employment_links`

### 5. `src/hooks/useLinkGroups.ts`

Expandir `useLinkGroupWorkers` select para incluir os 7 novos campos.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| Migração SQL | 1 coluna em `link_groups`, 7 em `link_group_workers` |
| `src/hooks/useLinkGroups.ts` | Expandir select |
| `src/pages/LinkForm.tsx` | Tipo contratação, remover Jornada |
| `src/pages/LinkDetail.tsx` | Dialog expandido, modal remoção, remover Jornada |
| `src/components/links/EventLinksList.tsx` | Reescrever para link_groups |

