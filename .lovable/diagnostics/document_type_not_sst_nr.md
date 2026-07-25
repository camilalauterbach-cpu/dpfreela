# `document_type_not_sst_nr` — objeto exato e definição SQL

Fonte: `supabase/migrations/20260721012627_953314d7-933f-4cfb-8468-bcef10d61882.sql`
(nenhuma migration posterior recria/derruba a função ou o trigger — grep em
`supabase/migrations` confirma que só existe esta ocorrência).

> Query do preview timed out ao rodar `pg_proc.prosrc ILIKE '%document_type_not_sst_nr%'`
> (SUPABASE_INTERNAL_ERROR / connection timeout). A definição abaixo é a instalada
> — corresponde 1:1 ao arquivo de migration acima. Quando o backend voltar,
> reconferir via `pg_get_functiondef` / `pg_get_triggerdef` (queries no fim).

## Objeto raiz

- **Função:** `public.validate_sst_qual_document_type()` (plpgsql, `SECURITY INVOKER`,
  `SET search_path = public, pg_temp`)
- **Trigger:** `trg_validate_sst_qual_document_type`
  em `public.worker_sst_qualifications`
  `AFTER INSERT OR UPDATE OF document_type_id`
  `FOR EACH ROW WHEN (NEW.document_type_id IS NOT NULL)`

## prosrc (função)

```plpgsql
DECLARE
  v_cat text;
BEGIN
  IF NEW.document_type_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT category INTO v_cat
    FROM public.document_types
   WHERE id = NEW.document_type_id;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'invalid_document_type' USING ERRCODE = '22023';
  END IF;
  IF v_cat <> 'sst_nr' THEN
    RAISE EXCEPTION 'document_type_not_sst_nr' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
```

## trigger_definition

```sql
DROP TRIGGER IF EXISTS trg_validate_sst_qual_document_type
  ON public.worker_sst_qualifications;
CREATE TRIGGER trg_validate_sst_qual_document_type
  AFTER INSERT OR UPDATE OF document_type_id
  ON public.worker_sst_qualifications
  FOR EACH ROW
  WHEN (NEW.document_type_id IS NOT NULL)
  EXECUTE FUNCTION public.validate_sst_qual_document_type();
```

## Causa exata do incidente Q-024-D-TRAINING-FIX

O trigger só aceita `document_types.category = 'sst_nr'`. Qualquer insert/update
de `worker_sst_qualifications` com `document_type_id` cuja categoria seja
`training` (ex.: **Treinamento Interno**, `b67b402f-2b56-41ce-bdf8-44a522d26178`)
dispara `RAISE EXCEPTION 'document_type_not_sst_nr'` com `ERRCODE 22023`,
**independentemente** da lógica category-aware já corrigida em
`register_sst_revision`. O trigger executa depois da RPC, portanto a rejeição
vem do banco, não do payload.

### Correção a aplicar (na próxima migration autorizada)

Ampliar a whitelist do trigger para `('sst_nr', 'training')` — mantendo o bloqueio
de qualquer outra categoria. Rascunho:

```sql
CREATE OR REPLACE FUNCTION public.validate_sst_qual_document_type()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE v_cat text;
BEGIN
  IF NEW.document_type_id IS NULL THEN RETURN NEW; END IF;
  SELECT category INTO v_cat FROM public.document_types WHERE id = NEW.document_type_id;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'invalid_document_type' USING ERRCODE = '22023';
  END IF;
  IF v_cat NOT IN ('sst_nr','training') THEN
    RAISE EXCEPTION 'document_type_not_sst_or_training'
      USING ERRCODE = '22023',
            HINT = format('categoria recebida: %s', v_cat);
  END IF;
  RETURN NEW;
END; $$;
```

## Como reconferir contra o banco (quando voltar)

```sql
-- Objeto exato
SELECT n.nspname || '.' || p.proname AS obj,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosrc ILIKE '%document_type_not_sst_nr%';

-- Trigger anexado
SELECT tgname, c.relname, pg_get_triggerdef(t.oid) AS trigger_definition
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND c.relname = 'worker_sst_qualifications'
   AND tgname = 'trg_validate_sst_qual_document_type';
```