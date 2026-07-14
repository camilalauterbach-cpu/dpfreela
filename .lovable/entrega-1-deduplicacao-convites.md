# Execute agora a Entrega 1

Execute agora a Entrega 1 exatamente conforme a especificação abaixo. O escopo está congelado. Não gere novo plano, não faça nova revisão arquitetural e não avance para etapas adiadas.

Antes de alterar qualquer arquivo, confirme o schema real das colunas utilizadas nos DDLs. Caso uma coluna citada não exista, interrompa apenas o artefato afetado, registre a divergência no relatório final e não improvise outra estrutura.

---

# Entrega 1 — Ordem definitiva de execução

## Correções incorporadas

1. **`ensure_worker` — CPF informado deve ter exatamente 11 dígitos e ser válido.**
2. **Matriz `payroll_batch_items` — comparar apenas campos materiais; ignorar `id`, `worker_id`, auditoria e campos técnicos.**
3. **Itens equivalentes no mesmo lote — manter o item do trabalhador principal e aplicar soft delete no item do secundário.**

---

## Artefatos autorizados

### Migração 0

Criar:

```text
supabase/migrations/<ts>_lgw_partial_unique.sql
```

A migration deve:

1. Executar um bloco `DO $$` que conte pares ativos duplicados por:

```text
link_group_id + worker_id
```

considerando somente:

```sql
deleted_at IS NULL
```

2. Se houver qualquer duplicidade ativa:

* executar `RAISE EXCEPTION`;
* informar a quantidade encontrada;
* abortar a migration;
* não remover a constraint;
* não alterar dados;
* registrar a divergência no relatório final.

3. Se não houver duplicidades:

```sql
ALTER TABLE public.link_group_workers
DROP CONSTRAINT link_group_workers_link_group_id_worker_id_key;
```

4. Criar:

```sql
CREATE UNIQUE INDEX link_group_workers_unique_active_group_worker
ON public.link_group_workers (
  link_group_id,
  worker_id
)
WHERE deleted_at IS NULL;
```

A Migração 0 só pode ser aplicada se o dry-run interno retornar zero pares ativos duplicados.

---

## Migração A1

Criar:

```text
supabase/migrations/<ts>_workers_normalization_prep.sql
```

Esta migration é preparatória e não deve criar índices únicos definitivos.

### Extensão

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### Colunas normalizadas em `workers`

Criar:

```sql
cpf_normalized text
GENERATED ALWAYS AS (
  regexp_replace(
    coalesce(cpf, ''),
    '\D',
    '',
    'g'
  )
) STORED
```

Criar:

```sql
document_number_normalized text
GENERATED ALWAYS AS (
  upper(
    regexp_replace(
      coalesce(document_number, ''),
      '[^A-Za-z0-9]',
      '',
      'g'
    )
  )
) STORED
```

Regras:

* CPF mantém somente números.
* Documento estrangeiro preserva letras e números.
* Documento estrangeiro remove espaços e pontuação.
* Documento estrangeiro converte letras para maiúsculas.
* Nunca aplicar a normalização numérica do CPF ao documento estrangeiro.

### Novas colunas em `workers`

Adicionar:

```text
linked_profile_id uuid REFERENCES public.profiles(id)
merged_into_worker_id uuid REFERENCES public.workers(id)
merged_at timestamptz
merged_by uuid
registration_status text NOT NULL DEFAULT 'incomplete'
```

Criar constraint para:

```text
registration_status IN ('complete', 'incomplete')
```

Regras:

* `linked_profile_id` referencia o ID real de `public.profiles`.
* Não presumir que `profiles.id` seja igual a `auth.users.id`.
* Não criar índice único de `linked_profile_id` nesta fase.
* Os índices únicos definitivos permanecem adiados para A10.

### Função de validação de CPF

Criar:

```text
public.is_valid_cpf(text)
```

Características:

```text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
```

A função deve:

* rejeitar valor cujo tamanho seja diferente de 11;
* rejeitar sequências repetidas;
* validar o primeiro dígito verificador;
* validar o segundo dígito verificador;
* retornar `boolean`.

### Constraint gradual de CPF

Criar:

```sql
ALTER TABLE public.workers
ADD CONSTRAINT workers_valid_cpf_check
CHECK (
  cpf_normalized = ''
  OR public.is_valid_cpf(cpf_normalized)
)
NOT VALID;
```

Não executar:

```sql
VALIDATE CONSTRAINT workers_valid_cpf_check;
```

nesta entrega.

### Índices comuns

Criar apenas índices não únicos, com filtro:

```sql
WHERE deleted_at IS NULL
```

Índices:

```text
cpf_normalized
document_type + document_number_normalized
GIN trigram em lower(full_name)
lower(email)
telefone normalizado por regexp_replace
```

Nenhum desses índices deve ser `UNIQUE`.

### Tabela `worker_duplicate_reviews`

Criar em `public`:

```text
id uuid PRIMARY KEY DEFAULT gen_random_uuid()
worker_a_id uuid NOT NULL REFERENCES workers(id)
worker_b_id uuid NOT NULL REFERENCES workers(id)
criteria text NOT NULL
decision text NOT NULL
reviewed_by uuid
reviewed_at timestamptz
reason text
created_at timestamptz NOT NULL DEFAULT now()
```

Constraint:

```text
decision IN (
  'pending',
  'kept_separate',
  'false_positive',
  'merged'
)
```

Unicidade:

```text
worker_a_id + worker_b_id + criteria
```

Permissões:

```text
GRANT SELECT, INSERT, UPDATE TO authenticated
GRANT ALL TO service_role
```

Ativar RLS.

Policies:

* somente admin pode consultar;
* somente admin pode inserir;
* somente admin pode atualizar;
* utilizar `has_role(auth.uid(), 'admin')`;
* nenhum acesso operacional para viewer, operator ou usuários não autenticados.

---

## Script de dry-run

Criar:

```text
scripts/sst-dedup-dry-run.sql
```

O script deve ser executável por `psql` e possuir somente consultas de leitura.

É proibido conter:

```text
INSERT
UPDATE
DELETE
ALTER
DROP
CREATE TABLE
CREATE INDEX
```

Pode utilizar `SELECT`, CTEs e `\copy`.

### Blocos obrigatórios

1. Total de trabalhadores ativos.
2. Total de trabalhadores soft-deleted.
3. CPFs exatos duplicados entre trabalhadores ativos.
4. Documentos estrangeiros exatos duplicados entre trabalhadores ativos.
5. Nome completo e data de nascimento idênticos.
6. Nome completo e telefone idênticos.
7. Nome completo e e-mail idênticos.
8. Similaridade de nome igual ou superior a `0.85`, combinada com a mesma data de nascimento.
9. Para cada grupo encontrado, contabilizar:

   * `employment_links` ativos;
   * `link_group_workers` ativos;
   * `worker_documents` ativos;
   * presença de `linked_profile_id`.

### Regras de comparação

CPF:

```sql
length(cpf_normalized) = 11
AND cpf_normalized <> ''
AND deleted_at IS NULL
```

Documento estrangeiro:

```sql
document_type IS NOT NULL
AND document_number_normalized <> ''
AND deleted_at IS NULL
```

Similaridade:

```sql
similarity(
  lower(worker_a.full_name),
  lower(worker_b.full_name)
) >= 0.85
```

O self-join deve evitar pares duplicados, utilizando regra como:

```sql
worker_a.id < worker_b.id
```

### Máscaras

CPF:

```text
***.***.***-XX
```

E-mail:

```text
x***@domínio
```

Telefone:

```text
apenas últimos quatro dígitos
```

### CSV

Gerar saída com `\copy` para:

```text
/mnt/documents/sst-dedup-dry-run-<data>.csv
```

O dry-run não pode gravar snapshot em `change_logs` nem alterar qualquer registro.

---

## RPC `ensure_worker`

Criar:

```text
supabase/migrations/<ts>_rpc_ensure_worker.sql
```

Assinatura obrigatória:

```sql
public.ensure_worker(
  payload jsonb,
  mode text DEFAULT 'auto'
)
RETURNS jsonb
```

Não substituir por parâmetros individuais.

### Segurança

A função deve possuir:

```text
SECURITY DEFINER
SET search_path = public, pg_temp
```

Executar:

```sql
REVOKE ALL
ON FUNCTION public.ensure_worker(jsonb, text)
FROM PUBLIC;
```

Executar:

```sql
GRANT EXECUTE
ON FUNCTION public.ensure_worker(jsonb, text)
TO authenticated;
```

Checagens internas:

* usuário não autenticado: bloquear;
* viewer sem outro role operacional: bloquear;
* `mode = 'auto'`: admin, manager e operator;
* `mode = 'force_create'`: apenas admin e manager;
* operator não pode superar alerta forte de possível duplicidade.

### Normalização

Dentro da RPC:

```text
CPF: apenas números
document_type: normalizado e não vazio
document_number: alfanumérico em maiúsculas
email: lowercase
telefone: apenas números
```

### Validação obrigatória de CPF

Aplicar:

```sql
IF v_cpf_norm <> '' THEN
  IF length(v_cpf_norm) <> 11
     OR NOT public.is_valid_cpf(v_cpf_norm) THEN
    RAISE EXCEPTION 'invalid_cpf'
      USING ERRCODE = '22023';
  END IF;
END IF;
```

Regras:

* CPF vazio pode ser admitido apenas para cadastro incompleto ou trabalhador estrangeiro.
* Qualquer CPF informado deve possuir exatamente 11 dígitos.
* Qualquer CPF informado deve passar em `is_valid_cpf`.

### Coerência do cadastro completo

Quando:

```text
registration_status = 'complete'
```

exigir pelo menos um identificador oficial válido:

* CPF válido; ou
* `document_type` preenchido e `document_number_normalized <> ''`.

Caso contrário:

```sql
RAISE EXCEPTION 'incomplete_worker_data'
USING ERRCODE = '22023';
```

### Fluxo de busca

#### Match exato por CPF

Executar somente quando:

```text
CPF normalizado possui 11 dígitos
CPF não está vazio
CPF é válido
worker está ativo
```

Se encontrar:

```json
{
  "result": "existing",
  "workerId": "uuid"
}
```

#### Match exato por documento estrangeiro

Executar somente quando:

```text
document_type não é nulo
document_number_normalized não está vazio
worker está ativo
```

Se encontrar, retornar `existing`.

#### Busca fuzzy

Quando:

```text
mode <> 'force_create'
```

buscar por:

* nome + nascimento;
* nome + telefone;
* nome + e-mail;
* similaridade de nome `>= 0.85` + nascimento.

Retornar:

```json
{
  "result": "possible_duplicate",
  "matches": []
}
```

Dados dos matches devem estar mascarados.

### Criação

Somente executar `INSERT` após:

* validação de CPF;
* validação de documento;
* busca exata;
* busca fuzzy;
* validação de role;
* validação de `registration_status`.

Retornar:

```json
{
  "result": "created",
  "workerId": "uuid"
}
```

### Concorrência

Tratar:

```text
unique_violation
```

Após A10, reler por CPF ou documento oficial e retornar `existing`.

Caso não seja possível localizar o trabalhador existente, relançar a exceção.

Não exibir código PostgreSQL ao usuário final.

---

## Migration A5 — convites e rate limit

Criar:

```text
supabase/migrations/<ts>_invites.sql
```

Esta migration é separada da A1.

### Tabela `invites`

Campos mínimos:

```text
id uuid PRIMARY KEY DEFAULT gen_random_uuid()
email_normalized text NOT NULL
token_hash text NOT NULL
role app_role NOT NULL
linked_worker_id uuid REFERENCES public.workers(id)
status text NOT NULL DEFAULT 'pending'
expires_at timestamptz NOT NULL
processing_started_at timestamptz
processing_nonce uuid
accepted_at timestamptz
accepted_auth_user_id uuid
accepted_profile_id uuid
attempt_count integer NOT NULL DEFAULT 0
last_error_code text
created_by uuid NOT NULL
created_at timestamptz NOT NULL DEFAULT now()
```

Estados permitidos:

```text
pending
processing
accepted
expired
revoked
```

Criar unique em:

```text
token_hash
```

Criar unique parcial:

```text
email_normalized
WHERE status IN ('pending', 'processing')
```

Ativar RLS.

Permissões:

* admin e manager podem gerenciar convites;
* operator e viewer não podem acessar a tabela;
* `service_role` possui acesso necessário;
* nenhum acesso a `anon`.

### Tabela `invite_attempts`

Campos:

```text
id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
ip_hash text NOT NULL
token_hash_prefix text
attempted_at timestamptz NOT NULL DEFAULT now()
success boolean NOT NULL DEFAULT false
```

Índices:

```text
ip_hash + attempted_at DESC
token_hash_prefix + attempted_at DESC
```

O segundo índice deve considerar apenas token não nulo.

Ativar RLS.

Permissões:

* acesso somente por `service_role`;
* nenhum grant para `anon`;
* nenhum grant para `authenticated`.

### RPC `claim_public_invite`

Criar RPC atômica:

```text
claim_public_invite(
  _token_hash text,
  _ip_hash text
)
```

Somente `service_role`.

Responsabilidades:

1. aplicar rate limit persistente;
2. verificar tentativas por IP;
3. verificar tentativas por token;
4. verificar falhas consecutivas por IP + token;
5. localizar o convite;
6. verificar expiração;
7. verificar estado;
8. recuperar `processing` abandonado;
9. realizar `pending → processing`;
10. gerar `processing_nonce`;
11. incrementar `attempt_count`;
12. retornar somente:

    * ID do convite;
    * e-mail do convite;
    * role do convite;
    * trabalhador relacionado;
    * nonce.

Limites iniciais:

```text
10 tentativas por IP em 10 minutos
5 tentativas por token em 10 minutos
3 falhas consecutivas por IP + token
bloqueio temporário de 30 minutos
processing abandonado após 2 minutos
```

Não retornar mensagens que revelem se o e-mail existe.

### RPC `complete_public_invite`

Criar:

```text
complete_public_invite(
  _invite_id uuid,
  _nonce uuid,
  _auth_user_id uuid,
  _profile_id uuid
)
```

Somente `service_role`.

Deve:

1. validar o convite;
2. validar `status = processing`;
3. validar o nonce;
4. validar o profile real;
5. aplicar a role gravada no convite;
6. usar `ON CONFLICT DO NOTHING` para não duplicar role;
7. associar `workers.linked_profile_id` ao ID real de `public.profiles`;
8. permitir idempotência quando o mesmo profile já estiver associado;
9. bloquear conflito com profile diferente;
10. marcar o convite como `accepted`;
11. preencher:

    * `accepted_auth_user_id`;
    * `accepted_profile_id`;
    * `accepted_at`;
12. registrar auditoria em `change_logs`.

Não confiar em role, e-mail ou trabalhador enviados pelo cliente.

### RPC `release_public_invite`

Criar:

```text
release_public_invite(
  _invite_id uuid,
  _nonce uuid,
  _error_code text
)
```

Somente `service_role`.

Deve:

* validar o nonce;
* alterar `processing → pending`;
* limpar campos de processamento;
* salvar `last_error_code`;
* não liberar processamento iniciado por outra execução.

### Permissões das três RPCs

Todas devem possuir:

```text
SECURITY DEFINER
SET search_path = public, pg_temp
```

Executar `REVOKE FROM PUBLIC`.

Conceder `EXECUTE` apenas a `service_role`.

---

## Edge Function

Criar:

```text
supabase/functions/public-invite-accept/index.ts
```

### Configuração

Adicionar em:

```text
supabase/config.toml
```

```toml
[functions.public-invite-accept]
verify_jwt = false
```

### Secret

Criar orientação para secret:

```text
INVITE_TOKEN_SECRET
```

O valor deve ter 64 caracteres aleatórios.

Não gravar o segredo no repositório.

### Requisição

Aceitar somente:

```text
POST
Content-Type: application/json
payload máximo: 2 KB
```

Body permitido:

```json
{
  "token": "...",
  "password": "..."
}
```

Ignorar ou rejeitar qualquer outro campo.

Não aceitar:

* e-mail;
* role;
* trabalhador;
* profile;
* organização;
* IDs internos.

### Segurança

* CORS restrito aos domínios autorizados do projeto;
* nunca utilizar `*` em produção;
* `SUPABASE_SERVICE_ROLE_KEY` somente via secret;
* nenhum token em log;
* nenhuma senha em log;
* nenhum e-mail em log;
* mensagens neutras;
* comportamento idempotente.

### Fluxo

1. validar método;
2. validar Content-Type;
3. validar tamanho;
4. validar token e senha;
5. calcular:

   * hash do token;
   * hash do IP;
6. chamar `claim_public_invite`;
7. criar ou reutilizar usuário no Auth;
8. confirmar e-mail conforme regra do convite;
9. localizar ou criar profile;
10. obter o ID real de `public.profiles.id`;
11. chamar `complete_public_invite`;
12. em falha recuperável, chamar `release_public_invite`;
13. responder de forma neutra.

A repetição da chamada não pode gerar:

* segundo usuário;
* segundo profile;
* segunda role;
* segundo vínculo.

---

## RPC `merge_workers` v1

Criar:

```text
supabase/migrations/<ts>_rpc_merge_workers_v1.sql
```

Assinatura obrigatória:

```sql
public.merge_workers(
  _primary uuid,
  _secondary uuid,
  _confirmation text
)
RETURNS jsonb
```

Não substituir por `p_dry_run`.

A função não pode referenciar `worker_sst_qualifications`.

### Segurança

* admin apenas;
* `SECURITY DEFINER`;
* `SET search_path = public, pg_temp`;
* `REVOKE FROM PUBLIC`;
* `GRANT EXECUTE TO authenticated`;
* checagem interna obrigatória de admin;
* `_primary <> _secondary`;
* ambos ativos;
* `SELECT ... FOR UPDATE` nos dois trabalhadores.

### Confirmação

Validar `_confirmation` contra a regra definida pela interface administrativa ou contra o nome do trabalhador principal.

Não executar merge sem confirmação válida.

### Fase de detecção

Executar integralmente antes de qualquer alteração.

Detectar simultaneamente:

1. dependentes com nome e nascimento iguais sem CPF conclusivo;
2. itens de folha do mesmo lote com divergência material;
3. `linked_profile_id` distintos e não nulos.

Retornar todos os conflitos encontrados, agrupados:

```ts
type MergeConflictGroup = {
  code:
    | "MERGE_CONFLICT_DEPENDENTS"
    | "MERGE_CONFLICT_PAYROLL_ITEMS"
    | "MERGE_CONFLICT_LINKED_PROFILE";
  records: Array<Record<string, unknown>>;
};
```

Retorno:

```json
{
  "result": "conflict",
  "conflicts": []
}
```

Conflitos previstos:

* não lançam exceção;
* não realizam alteração;
* são gravados em `change_logs`;
* retornam normalmente.

Exceções apenas para:

* autorização;
* parâmetros inválidos;
* trabalhador inexistente;
* falha inesperada;
* unique violation não prevista.

### Transferência — `employment_links`

Atualizar `worker_id` do secundário para o principal.

### Transferência — `link_group_workers`

Quando os dois estiverem ativos no mesmo grupo:

* manter a alocação principal;
* aplicar soft delete na alocação secundária;
* registrar origem em `notes`.

Quando não houver colisão:

* atualizar `worker_id`.

### Transferência — `employment_link_documents`

Transferir todos os documentos.

Anexar em `notes`:

```text
[MERGE] Originado do trabalhador secundário
```

### Transferência — `worker_documents`

Na primeira versão:

* transferir todos;
* preservar todos;
* não deduplicar por `category + document_type`;
* não aplicar soft delete por coincidência fraca.

Deduplicação automática somente quando houver identificador forte comprovado, como:

* hash de arquivo idêntico;
* número documental idêntico;
* chave externa idêntica.

Caso esses campos não existam, apenas transferir.

### Transferência — `worker_payment_methods`

Antes de transferir:

* resolver conflito de `is_preferred`;
* se ambos possuem preferido, remover a preferência do secundário;
* transferir os registros.

Somente considerar duplicidade forte quando houver:

* mesma `pix_key`; ou
* mesmo `bank_code + agency + account_number`.

Registros realmente idênticos do secundário podem ser soft-deleted, preservando auditoria.

### Transferência — `worker_dependents`

CPF idêntico:

* manter o principal;
* soft-delete do duplicado.

Somente nome e nascimento iguais sem CPF:

* retornar conflito;
* não consolidar automaticamente.

Demais registros:

* atualizar `worker_id`.

### Transferência — `payroll_batch_items`

A matriz real deve ser gerada antes do DDL final.

Comparar somente campos materiais.

Nunca comparar:

* `id`;
* `worker_id`;
* `created_at`;
* `updated_at`;
* `created_by`;
* `updated_by`;
* `deleted_at`;
* `deleted_by`;
* campos técnicos ou derivados.

Comparar, se existirem no schema:

* `batch_id`;
* competência;
* status;
* dias trabalhados;
* horas trabalhadas;
* salário-base;
* quantidade e valor de horas extras;
* adicionais;
* bônus;
* descontos;
* bruto;
* líquido;
* deduções;
* referência externa;
* snapshot do método de pagamento;
* demais componentes financeiros reais.

Qualquer divergência material no mesmo lote:

```text
MERGE_CONFLICT_PAYROLL_ITEMS
```

Quando os itens forem integralmente equivalentes:

* manter o item do trabalhador principal;
* soft-delete do item secundário;
* não somar valores;
* registrar em `notes`;
* registrar em `change_logs`.

Quando o item secundário não possuir equivalente no mesmo lote:

* atualizar `worker_id` para o principal.

### Finalização do trabalhador secundário

Atualizar:

```text
deleted_at = now()
merged_into_worker_id = _primary
merged_at = now()
merged_by = auth.uid()
```

### Auditoria

Utilizar o schema real de `change_logs`:

```text
table_name
record_id
action
old_data
new_data
changed_by
ip_address
created_at
```

Não utilizar campos inexistentes.

Criar logs para:

* conflito;
* consolidação de item de folha;
* sucesso da mesclagem.

### Retorno de sucesso

```json
{
  "result": "merged",
  "primaryId": "uuid",
  "secondaryId": "uuid",
  "transferred": {}
}
```

Não executar `COMMIT` ou `ROLLBACK` internamente.

---

## Matriz real de `payroll_batch_items`

Criar:

```text
.lovable/matrices/payroll_batch_items.md
```

A matriz deve ser gerada a partir de:

```text
information_schema.columns
```

do banco real.

Classificar cada coluna em:

| Categoria | Regra                              |
| --------- | ---------------------------------- |
| Comparar  | igualdade obrigatória              |
| Ignorar   | nunca entra na igualdade           |
| Revisar   | significado precisa ser confirmado |

`worker_id` deve estar obrigatoriamente em **Ignorar**.

O arquivo deve documentar:

* nome real;
* tipo;
* nullable;
* default;
* categoria;
* justificativa.

O DDL da mesclagem só pode utilizar colunas confirmadas como existentes.

---

## Rollback

Criar:

```text
.lovable/rollback/entrega-1.md
```

### Migração 0

Rollback:

1. verificar se foram criadas combinações que seriam proibidas pela constraint total;
2. se não houver, remover índice parcial;
3. recriar constraint total;
4. se houver, não recriar diretamente — gerar migration compensatória.

### A1

Antes de uso em produção:

* remover índices comuns;
* remover `workers_valid_cpf_check`;
* remover colunas novas;
* remover colunas geradas;
* remover `is_valid_cpf`;
* remover `worker_duplicate_reviews`.

Depois de uso real:

* não remover colunas com dados;
* desativar novos fluxos;
* reverter aplicação;
* manter rastreabilidade;
* utilizar migration corretiva.

### A5

* revogar permissões;
* remover as três RPCs;
* remover `invite_attempts`;
* remover `invites`;
* remover Edge Function;
* remover secret manualmente;
* reverter `config.toml`.

### `merge_workers` v1

```sql
DROP FUNCTION public.merge_workers(uuid, uuid, text);
```

A remoção da função não desfaz mesclagens já executadas.

---

## Regra de segurança operacional

Criar arquivos e executar apenas verificações seguras.

Não executar:

* `merge_workers` com trabalhadores reais;
* índices únicos definitivos de A10;
* `VALIDATE CONSTRAINT workers_valid_cpf_check`;
* tratamento automático de duplicidades;
* qualquer tabela ou interface SST.

A Migração 0 só pode ser aplicada quando o dry-run interno retornar zero duplicidades ativas.

---

## Fora desta entrega

Permanecem adiados:

* aplicação de `ensure_worker` nos formulários;
* tela `/settings/duplicates`;
* tratamento manual de duplicidades;
* novo dry-run pós-tratamento;
* índices únicos definitivos;
* tabela SST;
* views SST;
* interface SST;
* importação Rock in Rio;
* `merge_workers` v2.

---

## Retorno obrigatório após execução

Responder exclusivamente com:

1. arquivos criados ou alterados;
2. migrations criadas;
3. resultado e contagens do dry-run;
4. riscos identificados;
5. resultado do build;
6. resultado do `tsgo --noEmit`;
7. itens que aguardam aprovação.

Sem novo plano, sem alternativa arquitetural e sem avançar além da Entrega 1.