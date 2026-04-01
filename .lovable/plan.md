

# Fase 1 — Ajustes Finais + Execução

## Ajuste 1: CPF do Cadu

CPF inválido `79154sjd...` será substituído por **`30517397109`** (válido mod-11, fictício).

Tabela corrigida:

| Nome | Apelido | CPF |
|------|---------|-----|
| Maria Silva dos Santos | Má | 52998224725 |
| João Pedro de Oliveira | JP | 83749512030 |
| Ana Carolina Ferreira | Carol | 15647318700 |
| Carlos Eduardo Lima | Cadu | 30517397109 |
| Beatriz Souza Mendes | Bia | 64725913080 |

## Ajuste 2: Storage — Viewer mais restrito

Policies revisadas:

### `worker-documents`
| Operação | Admin | Manager | Operator | Viewer |
|----------|-------|---------|----------|--------|
| SELECT (download) | ✅ | ✅ | ✅ | ❌ |
| INSERT (upload) | ✅ | ✅ | ✅ | ❌ |
| UPDATE | ✅ | ✅ | ❌ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ |

### `link-documents`
| Operação | Admin | Manager | Operator | Viewer |
|----------|-------|---------|----------|--------|
| SELECT | ✅ | ✅ | ✅ | ✅ |
| INSERT | ✅ | ✅ | ✅ | ❌ |
| UPDATE | ✅ | ✅ | ❌ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ |

### `payment-receipts`
| Operação | Admin | Manager | Operator | Viewer |
|----------|-------|---------|----------|--------|
| SELECT | ✅ | ✅ | ✅ | ❌ |
| INSERT | ✅ | ✅ | ✅ | ❌ |
| UPDATE | ✅ | ✅ | ❌ | ❌ |
| DELETE | ✅ | ❌ | ❌ | ❌ |

**Resumo**: Viewer perde acesso a `worker-documents` (dados pessoais) e `payment-receipts` (comprovantes financeiros). Mantém acesso de leitura apenas a `link-documents` (documentos operacionais do vínculo).

---

## Execução — 8 etapas sequenciais

1. Habilitar Lovable Cloud (Supabase integrado)
2. Migration 1: enum `app_role`, função `has_role()`, `profiles` com trigger, `user_roles`
3. Migration 2: `companies`, `events`, `workers` (com CHECK CPF)
4. Migration 3: `worker_dependents`, `worker_payment_methods` (partial unique index), `worker_documents`
5. Migration 4: `employment_links` (40+ campos), `employment_link_documents`
6. Migration 5: `payroll_batches`, `payroll_batch_items`, `payment_receipts` (CHECK constraint), `change_logs`, `saved_filters`
7. Migration 6: RLS completo (admin/manager full, operator restrito, viewer read-only, change_logs imutável) + Storage buckets com policies granulares
8. Seed data com CPFs corrigidos + instalar dependências + criar client Supabase

