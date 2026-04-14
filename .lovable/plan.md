

## Tela operacional do trabalhador alocado no grupo/evento

### Migração SQL
Adicionar `link_group_worker_id uuid` à tabela `employment_link_documents`. Dados existentes intactos.

### Arquivos alterados

| Arquivo | Ação |
|---|---|
| Migração SQL | 1 coluna `link_group_worker_id` em `employment_link_documents` |
| `src/App.tsx` | Nova rota `/links/:groupId/workers/:workerId` |
| `src/pages/LinkWorkerDetail.tsx` | **Novo** — tela operacional com abas (Dados + Documentos) |
| `src/hooks/useLinkGroups.ts` | Novo hook `useLinkGroupWorker(groupId, workerId)` |
| `src/components/links/LinkDocumentsTab.tsx` | Novo prop `linkGroupWorkerId`, queries e inserts condicionais, storage path separado |
| `src/pages/LinkDetail.tsx` | Linhas da tabela de trabalhadores clicáveis → navegam para a tela operacional |
| `src/lib/export-docs-zip.ts` | Suporte a `linkGroupWorkerId` nos downloads |

### Detalhes técnicos

**LinkDocumentsTab** — quando `linkGroupWorkerId` presente:
- Queries filtram por `link_group_worker_id` em vez de `employment_link_id`
- Inserts preenchem `link_group_worker_id` (sem preencher `employment_link_id`)
- Storage path: `{workerId}/{linkGroupWorkerId}/{category}_{timestamp}.ext`
- Quando ausente: comportamento legado inalterado

**LinkWorkerDetail** — layout:
- Header com breadcrumb (Grupo → Trabalhador)
- Aba "Dados": cards de Identificação, Contrato, Jornada, Remuneração (tipo + valor efetivo + valor referência), Benefícios
- Aba "Documentos": `LinkDocumentsTab` com `linkGroupWorkerId` + `requiredDocuments` do grupo

**Regra de dono do documento**:
- Documento legado → `employment_link_id`
- Documento novo (modelo grupo) → `link_group_worker_id`
- Documento do evento → `event_id`
- Sem ambiguidade entre os três

