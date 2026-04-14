

## Plano: Separar exigências do trabalhador (flags) vs documentos do evento (uploads)

### Problema

Flags de exigência para trabalhadores e uploads de documentos da operação estão misturados no mesmo nível. PGR, LTCAT, seguros aparecem como itens a serem enviados por trabalhador no vínculo, quando deveriam ficar no evento.

### Alterações

#### 1. Migração SQL

Adicionar `event_id` nullable à tabela `employment_link_documents`, tornar `employment_link_id` nullable, e adicionar constraint que garante que todo registro tenha pelo menos um "dono" (vínculo ou evento).

```sql
ALTER TABLE employment_link_documents
  ADD COLUMN IF NOT EXISTS event_id uuid;

ALTER TABLE employment_link_documents
  ALTER COLUMN employment_link_id DROP NOT NULL;

-- Constraint: todo registro deve ter employment_link_id OU event_id
ALTER TABLE employment_link_documents
  ADD CONSTRAINT chk_document_owner
  CHECK (employment_link_id IS NOT NULL OR event_id IS NOT NULL);
```

Registros existentes já têm `employment_link_id` preenchido, então a constraint não afeta dados atuais.

#### 2. Novo: `src/components/events/EventDocumentsTab.tsx`

Componente de upload/listagem de documentos do evento. Categorias fixas:
- Manual de credenciamento, PGR, LTCAT, APR, ART, NIR, Seguros, Laudos do evento, Documentos gerais

Usa `employment_link_documents` com `event_id` preenchido e `employment_link_id` nulo. Upload para bucket `link-documents` com path `events/{eventId}/{category}_{timestamp}.ext`.

Inclui comentário de débito técnico: futuramente considerar tabela dedicada `event_documents`.

Validação na aplicação: todo insert sempre preenche `event_id`.

#### 3. Modificar: `src/pages/EventDetail.tsx`

- Adicionar aba "Documentos" ao TabsList (ao lado de "Informações" e "Vínculos")
- Renderizar `EventDocumentsTab` nessa aba
- Renomear card "Requisitos documentais" para **"Exigências para trabalhadores alocados"**

#### 4. Modificar: `src/pages/EventForm.tsx`

- Renomear título do card de "Requisitos documentais" para **"Exigências para trabalhadores alocados"**
- Sem mudança funcional nos campos

#### 5. Modificar: `src/components/links/LinkDocumentConfigForm.tsx`

- Remover seção C ("Documentos da empresa/operação exigidos no vínculo") do formulário
- O campo `company` permanece no tipo `LinkDocumentConfig` para compatibilidade com dados legados

#### 6. Modificar: `src/components/links/LinkDocumentsTab.tsx`

- Remover renderização do bloco `companyDocs` do fluxo ativo
- Adicionar seção legado: se `companyDocs.length > 0` E existem docs com essas categorias no banco, exibir bloco discreto com título "Documentos da empresa (legado)" em estilo `muted`, somente leitura, com nota: "Estes documentos foram configurados antes da separação. Novos documentos da empresa devem ser enviados na aba Documentos do evento."

### Resumo de arquivos

| Arquivo | Ação |
|---|---|
| Migração SQL | `event_id` nullable + `employment_link_id` nullable + constraint `chk_document_owner` |
| `src/components/events/EventDocumentsTab.tsx` | **Novo** — upload/listagem de docs do evento |
| `src/pages/EventDetail.tsx` | Aba "Documentos" + renomear requisitos |
| `src/pages/EventForm.tsx` | Renomear card |
| `src/components/links/LinkDocumentConfigForm.tsx` | Remover seção C |
| `src/components/links/LinkDocumentsTab.tsx` | Legado discreto somente leitura |

### Integridade

- Nenhum dado existente deletado ou sobrescrito
- Constraint garante que todo registro futuro tenha dono (vínculo ou evento)
- Registros existentes já têm `employment_link_id` — constraint não os afeta
- Dados legados de `required_documents.company` e docs já enviados continuam visíveis em bloco discreto
- Débito técnico documentado no código

