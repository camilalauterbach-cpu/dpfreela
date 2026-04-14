

## Etapa 2 — Migração dos 27 trabalhadores do evento da Shakira

### Passo 1: Criar 1 link_group

```sql
INSERT INTO link_groups (group_name, event_id, company_id, hire_date, end_date, status)
VALUES (
  'Equipe - Show da Shakira no RJ',
  'b1b2c3d4-0002-4000-8000-000000000002',
  'a1b2c3d4-0001-4000-8000-000000000001',
  '2026-04-26',
  '2026-05-04',
  'draft'
);
```

- `company_id` extraído do evento (confirmado: `a1b2c3d4-0001-4000-8000-000000000001`)

### Passo 2: Buscar o ID do grupo recém-criado

```sql
SELECT id FROM link_groups
WHERE event_id = 'b1b2c3d4-0002-4000-8000-000000000002'
LIMIT 1;
```

### Passo 3: Inserir os 27 trabalhadores no link_group_workers

```sql
INSERT INTO link_group_workers (link_group_id, worker_id, job_role, job_function, contract_type, status)
SELECT
  '<id_do_grupo_criado_no_passo_2>',
  worker_id,
  job_role,
  job_function,
  contract_type,
  'active'
FROM employment_links
WHERE deleted_at IS NULL
  AND event_id = 'b1b2c3d4-0002-4000-8000-000000000002';
```

- Filtro explícito por `event_id` — migra apenas os 27 do Shakira
- `hire_date`/`end_date` individuais não preenchidos (iguais ao grupo)
- Campos financeiros todos nulos nos registros atuais — ficam nulos

### Validação após execução

Confirmar:
- 1 registro em `link_groups`
- 27 registros em `link_group_workers` com o `link_group_id` correto
- Dados de `job_role`, `job_function`, `contract_type` preservados

### O que NÃO será feito

- Nenhuma alteração nos 27 registros de `employment_links`
- Nenhuma alteração de frontend
- Nenhum soft-delete

