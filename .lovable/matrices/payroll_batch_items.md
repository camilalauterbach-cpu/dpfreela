# Matriz de comparação — `public.payroll_batch_items`

Fonte: `information_schema.columns` no banco real (14 colunas confirmadas).

`worker_id` está obrigatoriamente em **Ignorar**.

| Coluna | Tipo | Nullable | Default | Categoria | Justificativa |
|---|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | Ignorar | Identificador técnico do registro. |
| `batch_id` | uuid | NO | — | Comparar | Escopo do lote — dois itens só são potencialmente equivalentes se pertencem ao MESMO lote. |
| `worker_id` | uuid | NO | — | Ignorar | É justamente o campo que a mesclagem substitui (primário ↔ secundário). |
| `employment_link_id` | uuid | YES | — | Comparar | Vínculo de origem do lançamento; divergência aqui indica lançamentos materialmente distintos. |
| `base_amount` | numeric | NO | 0 | Comparar | Componente financeiro material — salário-base do item. |
| `overtime_amount` | numeric | YES | 0 | Comparar | Componente financeiro material — horas extras. |
| `deductions` | numeric | YES | 0 | Comparar | Componente financeiro material — deduções. |
| `bonuses` | numeric | YES | 0 | Comparar | Componente financeiro material — bônus/adicionais. |
| `net_amount` | numeric | NO | 0 | Comparar | Componente financeiro material — valor líquido. |
| `status` | text | NO | `'pending'` | Comparar | Estado operacional do item; equivalência exige mesmo estado. |
| `notes` | text | YES | — | Ignorar | Campo livre de auditoria — a mesclagem já concatena origem nos `notes`. |
| `deleted_at` | timestamptz | YES | — | Ignorar | Estado de soft-delete; comparação e filtragem tratadas fora da igualdade material. |
| `created_at` | timestamptz | NO | `now()` | Ignorar | Auditoria técnica. |
| `updated_at` | timestamptz | NO | `now()` | Ignorar | Auditoria técnica. |

## Regra de equivalência material aplicada em `merge_workers` v1

Dois itens `(primário, secundário)` no MESMO `batch_id` são considerados **integralmente equivalentes** quando **todos** os campos da categoria **Comparar** coincidem (com `IS NOT DISTINCT FROM`, para tratar NULLs corretamente):

- `batch_id`
- `employment_link_id`
- `base_amount`
- `overtime_amount`
- `deductions`
- `bonuses`
- `net_amount`
- `status`

**Ação em caso de equivalência:** manter o item do trabalhador principal e aplicar soft-delete no item do secundário (`deleted_at = now()`), anexando origem em `notes`. Nunca somar valores.

**Ação em caso de divergência material no mesmo lote:** não alterar; retornar como conflito `MERGE_CONFLICT_PAYROLL_ITEMS`.

**Ação quando o item secundário não possui equivalente no mesmo lote:** apenas atualizar `worker_id` para o principal.

## Colunas ausentes citadas pela spec (não presentes no schema real)

A spec lista opcionalmente estes campos "se existirem no schema": competência, dias trabalhados, horas trabalhadas, salário-base separado de horas extras (só existe agregado), adicionais separados, referência externa, snapshot do método de pagamento, quantidade de horas extras. **Nenhum deles existe em `public.payroll_batch_items`** e portanto **não entram na igualdade material** — a comparação usa exclusivamente as 8 colunas Comparar acima.