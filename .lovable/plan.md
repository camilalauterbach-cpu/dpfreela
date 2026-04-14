

## Etapa 1 — Migração SQL do schema

Primeira etapa isolada. Criar as duas tabelas novas com RLS e triggers, sem tocar em nenhuma tabela existente.

### SQL a executar

**Tabela `link_groups`** (agrupador):
- Todos os campos do plano v3: `group_name`, `event_id`, `company_id`, `status`, `hire_date`, `end_date`, jornada, operacional, `required_documents`, `notes`, `deleted_at`, timestamps
- RLS habilitado com 4 policies (select/insert/update/delete) usando `has_any_role`, idênticas às de `employment_links`
- Trigger `update_updated_at_column` em UPDATE

**Tabela `link_group_workers`** (alocação individual):
- Campos individuais: `link_group_id`, `worker_id`, `job_role`, `job_function`, `department`, `contract_type`, `hire_date`, `end_date`, `remuneration_type`, `daily_rate`, `hourly_rate`, `fixed_salary`, `payment_frequency`, `has_transport_allowance`, `transport_allowance`, `has_meal_allowance`, `meal_allowance`, `status`, `notes`, `deleted_at`, timestamps
- Constraint `UNIQUE(link_group_id, worker_id)`
- RLS habilitado com 4 policies idênticas
- Trigger `update_updated_at_column` em UPDATE

### O que NÃO será feito nesta etapa

- Nenhuma alteração em tabelas existentes
- Nenhuma migração de dados
- Nenhuma alteração de frontend

### Validação esperada após esta etapa

Confirmar via query que as duas tabelas existem, RLS está habilitado, e as policies estão aplicadas.

