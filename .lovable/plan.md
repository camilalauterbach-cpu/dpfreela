

## Plano de implementação: Reorganização documental no vínculo + categoria "Outros"

### Resumo das mudanças

Cinco arquivos serão modificados/criados. Nenhuma migração de banco. Totalmente não destrutivo.

### 1. `src/lib/worker-completeness.ts`
- Adicionar `"outros"` ao `CONDITIONAL_DOC_CATEGORIES`
- Adicionar label: `outros: "Outros (complementares)"`

### 2. `src/components/workers/DocumentChecklist.tsx`
- Na categoria `"outros"`: cada upload cria um **novo registro** (insert sempre, nunca update)
- Exibir todos os docs "outros" como lista com nome do arquivo + data
- Cada item com botão Ver e seletor de status
- Botão "Adicionar documento" sempre visível na seção "outros"
- Texto orientativo: *"Documentos de filhos, declaração racial, comprovantes complementares, etc."*

### 3. `src/components/links/LinkDocumentsTab.tsx` (novo)
Recebe `workerId`, `employmentLinkId`, `event`, `workerName`.

**Seção A — Documentos do Trabalhador (somente leitura)**
- Busca `worker_documents` do worker
- Exibe todas as categorias obrigatórias + condicionais com status (aprovado, pendente, enviado, etc.)
- Categorias sem arquivo aparecem como "Pendente"
- Sem botões de upload/edição
- Aviso com link: *"Para incluir ou alterar documentos, acesse o cadastro do trabalhador."* → navega para `/workers/{workerId}?tab=documentos`

**Seção B — Documentos do Evento/Vínculo**
- Mantém `OperationalDocsChecklist` existente (editável)

**Seção C — Pendências (dois blocos separados)**
- **Pendências do trabalhador**: docs obrigatórios faltantes OU com status != approved (uploaded, pending, rejected, replace). Ignora condicionais/opcionais não enviados.
- **Pendências do evento**: docs operacionais faltantes OU com status != approved. Só mostra docs exigidos pelo evento.

**Botões de download no topo:**
- "Baixar docs do trabalhador" — ZIP do bucket `worker-documents`
- "Baixar docs do evento" — ZIP do bucket `link-documents`
- "Baixar todos" — ZIP com subpastas `/documentos_trabalhador/` e `/documentos_evento/`

### 4. `src/pages/LinkDetail.tsx`
- Substituir conteúdo da aba "Documentos" pelo novo `LinkDocumentsTab`

### 5. `src/lib/export-docs-zip.ts`
- Adicionar função `exportLinkDocsZip(params)` com `mode: 'worker' | 'event' | 'all'`
- Modo `all` organiza em subpastas `/documentos_trabalhador/` e `/documentos_evento/`

### 6. `src/pages/WorkerDetail.tsx`
- Ler query param `?tab=documentos` para abrir na aba correta via `useSearchParams`

### Regra de pendências (conforme solicitado)
- **Pendente** = documento faltante (sem registro) OU documento existente com status diferente de "approved"
- **Não poluir** = documentos condicionais/opcionais que não foram enviados NÃO aparecem no resumo de pendências (exceto se exigidos pelo evento)

### Integridade
- Zero migrações de banco
- Documentos globais: somente leitura no vínculo
- Nenhum dado existente movido, alterado ou deletado
- Categoria "outros" apenas adiciona novos registros

