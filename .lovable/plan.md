

## Plano de implementação: Dados bancários estruturados + comprovante automático

### Resumo

5 alterações: 1 migração SQL, 2 arquivos novos, 2 arquivos modificados. Totalmente não destrutivo.

### 1. Migração SQL

```sql
ALTER TABLE worker_payment_methods
  ADD COLUMN IF NOT EXISTS holder_name text,
  ADD COLUMN IF NOT EXISTS holder_cpf text;
```

### 2. Novo: `src/lib/generate-bank-receipt.ts`

Função usando `jspdf` (já instalado) que recebe os dados bancários e retorna um `Blob` PDF contendo:

- Título: "Comprovante de Dados Bancários"
- Subtítulo: "Gerado automaticamente pelo sistema"
- Data/hora de geração (pt-BR)
- Nome + CPF do trabalhador
- Banco (nome/código)
- Agência e Conta (quando preenchidos)
- Tipo de conta (Corrente/Poupança)
- Tipo de chave Pix (CPF/Telefone/E-mail/Aleatória) + Chave Pix
- Titular: nome + CPF + indicação "Próprio trabalhador" ou "Terceiro"
- Nome do usuário logado que gerou
- Rodapé de validade documental

### 3. Novo: `src/components/workers/BankDataForm.tsx`

Props: `workerId`, `workerName`, `workerCpf`, `onSuccess`.

Formulário Pix-first:
- Bloco principal: Tipo de chave Pix + Chave Pix + Banco (obrigatório)
- Seção expansível (Collapsible): Agência, Conta, Tipo de conta — opcional
- Checkbox "Titular é o próprio trabalhador" (pré-marcado) + campos Titular/CPF

Ao salvar:
1. Insere em `worker_payment_methods` com `holder_name`, `holder_cpf`
2. Gera PDF via `generate-bank-receipt`
3. Upload para `worker-documents/{workerId}/bank_document/{timestamp}.pdf`
4. Insere novo registro em `worker_documents` com `category = "bank_document"`, `status = "uploaded"`, `notes = "auto_generated"`

### 4. Modificar: `src/components/workers/DocumentChecklist.tsx`

Props: adicionar `workerName?: string`, `workerCpf?: string`.

Mudanças no card `bank_document`:
- Remover `bank_document` do loop `renderDocCard` de obrigatórios
- Criar seção dedicada `renderBankDocumentSection()` (similar a `renderOutrosSection`)
- Buscar todos os docs com `category = "bank_document"` (múltiplos registros)
- Cada doc exibe badge de origem: "Upload manual" ou "Gerado pelo sistema" (baseado em `notes === "auto_generated"`)
- Dois botões de ação: "Enviar comprovante" (upload com `alwaysInsert = true`) e "Preencher dados bancários" (abre Dialog com `BankDataForm`)
- Quando já existe doc ativo, AlertDialog de confirmação: "Adicionar" (coexistência) ou "Substituir" (soft-delete do anterior via `UPDATE ... SET deleted_at = now()`, arquivo no storage preservado)
- Ação padrão: preservar o existente

### 5. Modificar: `src/pages/WorkerDetail.tsx`

Passar `workerName={worker.full_name}` e `workerCpf={worker.cpf}` para `<DocumentChecklist>`.

### Integridade

- Nenhum dado existente alterado ou removido
- "Substituir" usa soft-delete (`deleted_at = now()`) — registro antigo permanece no banco, arquivo permanece no storage
- Uploads manuais e comprovantes gerados coexistem com identificação visual clara
- `jspdf` já instalado — zero dependências novas
- `bank_document` continua contando como doc obrigatório para DP readiness (lógica em `computeDocCompleteness` já funciona)

