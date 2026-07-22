# Rollback — Q-014.1 Fundação canônica da política de validade

## Pré-condição
Nenhum fluxo Q-014.2+ (drawer, uploads, `evaluate_link_compliance`, motor de
conformidade, telas operacionais, register_sst_revision) pode estar consumindo
os novos campos ou a função `calculate_document_expiry`. Verificar com:

```sql
SELECT proname FROM pg_proc WHERE prosrc ILIKE '%calculate_document_expiry%';
```

Rollback só é seguro quando essa consulta devolve apenas a própria função
`calculate_document_expiry`.

## Passos (em ordem, dentro de uma única transação)

```sql
BEGIN;

-- 1. Função
DROP FUNCTION IF EXISTS public.calculate_document_expiry(
  date,
  public.document_validity_mode,
  integer,
  public.document_validity_unit,
  date
);

-- 2. Constraint override
ALTER TABLE public.job_role_document_requirements
  DROP CONSTRAINT IF EXISTS job_role_requirement_validity_override_check;

-- 3. Constraint document_types
ALTER TABLE public.document_types
  DROP CONSTRAINT IF EXISTS document_types_validity_policy_check;

-- 4. Colunas requirements
ALTER TABLE public.job_role_document_requirements
  DROP COLUMN IF EXISTS validity_override_value,
  DROP COLUMN IF EXISTS validity_override_unit;

-- 5. Colunas document_types
ALTER TABLE public.document_types
  DROP COLUMN IF EXISTS validity_mode,
  DROP COLUMN IF EXISTS validity_value,
  DROP COLUMN IF EXISTS validity_unit;

-- 6. Enums (apenas após confirmar ausência de dependências)
DO $$
DECLARE deps int;
BEGIN
  SELECT COUNT(*) INTO deps
    FROM pg_depend d
    JOIN pg_type t ON t.oid = d.refobjid
    WHERE t.typname IN ('document_validity_mode','document_validity_unit')
      AND d.deptype <> 'i';
  IF deps <> 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % dependências restantes nos enums', deps;
  END IF;
END $$;

DROP TYPE IF EXISTS public.document_validity_unit;
DROP TYPE IF EXISTS public.document_validity_mode;

COMMIT;
```

## Invariantes pós-rollback
- `worker_sst_qualifications` inalterada (checksum idêntico ao baseline
  `9c88dcf4e4b34c0523235e378c7b88af`).
- Campos legados preservados: `document_types.has_expiration`,
  `document_types.default_validity_days`,
  `job_role_document_requirements.validity_days_override`.
- Aplicação atual (Fase 1.5) continua compilando: nenhum componente consome
  `validity_mode` / `validity_value` / `validity_unit` /
  `calculate_document_expiry` neste momento.
- Reaplicação da migration Q-014.1 volta a funcionar sem alterações
  (mesma idempotência já validada).

## Confirmação de segurança
A correção Q-014.1-LEGACY-FIX (override -2 → NULL) permanece válida após o
rollback: `job_role_document_requirements` não foi afetada pelo rollback além
da remoção das novas colunas.