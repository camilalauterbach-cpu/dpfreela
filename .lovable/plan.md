

## Exportações operacionais do grupo para contabilidade

### Resumo
Criar novo arquivo `src/lib/export-group.ts` com duas funções (Excel e PDF) e adicionar botões na aba Trabalhadores do `LinkDetail.tsx`.

### Arquivos

| Arquivo | Ação |
|---|---|
| `src/lib/export-group.ts` | **Novo** — `exportGroupXlsx` e `exportGroupPdf` |
| `src/pages/LinkDetail.tsx` | Botões "Excel" e "PDF" na aba Trabalhadores |

### 1. `src/lib/export-group.ts`

**`exportGroupXlsx(groupId, groupName, eventName, companyName, period)`**
- Fetch on-demand: `link_group_workers` do grupo (com `workers(*)` completo via select join)
- Para cada worker_id, buscar `worker_payment_methods` ordenado por `is_preferred DESC, created_at DESC`, pegar o primeiro ativo (deleted_at IS NULL)
- Montar planilha ExcelJS com ~75 colunas, mesma estrutura do `export-admission.ts` adaptada ao modelo de grupos:
  - Dados cadastrais do trabalhador (todos os campos da tabela `workers`, mesmo vazios)
  - Dados da alocação (job_role, job_function, department, contract_type, status, hire_date, end_date, remuneration_type, daily_rate, hourly_rate, fixed_salary, category_reference_rate, payment_frequency, VT, VR/VA, horas, turno, escala, horário, call_time, notes)
  - Dados bancários (method_type, pix_key, pix_key_type, bank_name, bank_code, agency, account_number, account_type, holder_name, holder_cpf)
  - Grupo, Evento, Empresa como colunas contextuais
- Campos vazios saem em branco (string vazia), nunca omitidos
- Nome do arquivo: `grupo_<nome>_contabilidade_YYYY-MM-DD.xlsx`

**`exportGroupPdf(groupId, groupName, eventName, companyName, period, workerCount)`**
- Fetch on-demand: mesmos dados mas renderiza resumido
- jsPDF + autoTable
- Header: nome do grupo, evento, empresa, período (hire_date – end_date), quantidade de trabalhadores, data de geração
- Tabela resumida: Nome, CPF, Função, Contrato, Tipo Remuneração, Valor efetivo, VT, VR/VA, Status
- Nome do arquivo: `grupo_<nome>_resumo_YYYY-MM-DD.pdf`

### 2. `src/pages/LinkDetail.tsx`

Na aba "Trabalhadores" (linha 334-340), ao lado do botão "Alocar trabalhador":
- Botão "Excel" (ícone Download) e botão "PDF" (ícone FileText)
- Desabilitados quando `!workers?.length`
- Loading state individual por botão
- Chamam as funções passando `id`, `g.group_name`, `eventName`, `companyName`, período (`g.hire_date` – `g.end_date`)
- Toast de sucesso/erro

### Dados bancários — regra de seleção
1. Método com `is_preferred = true` e `deleted_at IS NULL`
2. Se não existir preferido, o mais recente ativo (`ORDER BY created_at DESC LIMIT 1`)
3. Se nenhum, colunas bancárias em branco

### Garantias
- Sem alterar dados existentes
- Sem mexer no legado de `employment_links`
- Sem remover `export-admission.ts` ou `export-payroll.ts`
- Fetch pesado apenas no momento do clique de exportação

