-- =====================================================================
-- Dry-run de deduplicação de trabalhadores — Entrega 1
-- Somente leitura. Proibido INSERT/UPDATE/DELETE/ALTER/DROP/CREATE.
-- Executar via: psql -f scripts/sst-dedup-dry-run.sql
-- =====================================================================

\timing on
\pset pager off

-- ---------------------------------------------------------------------
-- Bloco 1: total de trabalhadores ativos
-- ---------------------------------------------------------------------
SELECT 'ativos' AS metrica, count(*) AS total
FROM public.workers
WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Bloco 2: total de trabalhadores soft-deleted
-- ---------------------------------------------------------------------
SELECT 'soft_deleted' AS metrica, count(*) AS total
FROM public.workers
WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- Bloco 3: CPFs exatos duplicados entre trabalhadores ativos
-- ---------------------------------------------------------------------
WITH dup_cpf AS (
  SELECT cpf_normalized, count(*) AS qtd
  FROM public.workers
  WHERE deleted_at IS NULL
    AND cpf_normalized <> ''
    AND length(cpf_normalized) = 11
  GROUP BY cpf_normalized
  HAVING count(*) > 1
)
SELECT
  '***.***.***-'
    || right(dc.cpf_normalized, 2) AS cpf_mascarado,
  dc.qtd,
  w.id AS worker_id,
  substr(coalesce(w.email,''), 1, 1) || '***@'
    || split_part(coalesce(w.email,''), '@', 2) AS email_mascarado,
  right(regexp_replace(coalesce(w.phone_main,''), '\D', '', 'g'), 4)
    AS telefone_ultimos_4,
  w.deleted_at
FROM dup_cpf dc
JOIN public.workers w ON w.cpf_normalized = dc.cpf_normalized
WHERE w.deleted_at IS NULL
ORDER BY dc.cpf_normalized, w.created_at;

-- ---------------------------------------------------------------------
-- Bloco 4: DIVERGÊNCIA DE SCHEMA
-- ---------------------------------------------------------------------
-- public.workers não possui colunas document_type / document_number.
-- Bloco de documentos estrangeiros suprimido conforme regra:
-- "Caso uma coluna citada não exista, interrompa apenas o artefato
-- afetado e registre a divergência no relatório final."
-- ---------------------------------------------------------------------
SELECT 'documento_estrangeiro' AS bloco,
       'SKIPPED_SCHEMA_DIVERGENCE' AS status;

-- ---------------------------------------------------------------------
-- Bloco 5: nome completo + data de nascimento idênticos
-- ---------------------------------------------------------------------
WITH dup_nb AS (
  SELECT lower(full_name) AS name_key, birth_date, count(*) AS qtd
  FROM public.workers
  WHERE deleted_at IS NULL
    AND full_name IS NOT NULL
    AND birth_date IS NOT NULL
  GROUP BY lower(full_name), birth_date
  HAVING count(*) > 1
)
SELECT d.name_key, d.birth_date, d.qtd,
       w.id AS worker_id,
       '***.***.***-' || right(coalesce(w.cpf_normalized,''),2)
         AS cpf_mascarado
FROM dup_nb d
JOIN public.workers w
  ON lower(w.full_name) = d.name_key
 AND w.birth_date = d.birth_date
WHERE w.deleted_at IS NULL
ORDER BY d.name_key, d.birth_date;

-- ---------------------------------------------------------------------
-- Bloco 6: nome completo + telefone idênticos
-- ---------------------------------------------------------------------
WITH ph AS (
  SELECT id, lower(full_name) AS name_key,
         regexp_replace(coalesce(phone_main,''), '\D', '', 'g') AS phone_norm
  FROM public.workers
  WHERE deleted_at IS NULL
    AND phone_main IS NOT NULL
    AND full_name IS NOT NULL
),
dup_np AS (
  SELECT name_key, phone_norm, count(*) AS qtd
  FROM ph
  WHERE phone_norm <> ''
  GROUP BY name_key, phone_norm
  HAVING count(*) > 1
)
SELECT d.name_key,
       right(d.phone_norm, 4) AS telefone_ultimos_4,
       d.qtd,
       ph.id AS worker_id
FROM dup_np d
JOIN ph ON ph.name_key = d.name_key AND ph.phone_norm = d.phone_norm
ORDER BY d.name_key;

-- ---------------------------------------------------------------------
-- Bloco 7: nome completo + e-mail idênticos
-- ---------------------------------------------------------------------
WITH dup_ne AS (
  SELECT lower(full_name) AS name_key, lower(email) AS email_key, count(*) AS qtd
  FROM public.workers
  WHERE deleted_at IS NULL
    AND email IS NOT NULL
    AND full_name IS NOT NULL
  GROUP BY lower(full_name), lower(email)
  HAVING count(*) > 1
)
SELECT d.name_key,
       substr(d.email_key,1,1) || '***@' || split_part(d.email_key,'@',2) AS email_mascarado,
       d.qtd,
       w.id AS worker_id
FROM dup_ne d
JOIN public.workers w
  ON lower(w.full_name) = d.name_key
 AND lower(w.email) = d.email_key
WHERE w.deleted_at IS NULL
ORDER BY d.name_key;

-- ---------------------------------------------------------------------
-- Bloco 8: similaridade de nome >= 0.85 + mesma data de nascimento
-- Requer extensão pg_trgm ativa (criada na Migração A1).
-- ---------------------------------------------------------------------
SELECT
  a.id AS worker_a_id,
  b.id AS worker_b_id,
  a.full_name AS nome_a,
  b.full_name AS nome_b,
  a.birth_date,
  round(similarity(lower(a.full_name), lower(b.full_name))::numeric, 3)
    AS similaridade
FROM public.workers a
JOIN public.workers b
  ON a.id < b.id
 AND a.birth_date = b.birth_date
 AND similarity(lower(a.full_name), lower(b.full_name)) >= 0.85
WHERE a.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND a.birth_date IS NOT NULL
ORDER BY similaridade DESC;

-- ---------------------------------------------------------------------
-- Bloco 9: contagem por grupo — vínculos e documentos ativos
-- ---------------------------------------------------------------------
WITH candidatos AS (
  SELECT id FROM public.workers
  WHERE deleted_at IS NULL AND cpf_normalized <> '' AND length(cpf_normalized)=11
    AND cpf_normalized IN (
      SELECT cpf_normalized FROM public.workers
      WHERE deleted_at IS NULL AND cpf_normalized <> '' AND length(cpf_normalized)=11
      GROUP BY cpf_normalized HAVING count(*) > 1
    )
)
SELECT c.id AS worker_id,
       (SELECT count(*) FROM public.employment_links el
          WHERE el.worker_id = c.id AND el.deleted_at IS NULL) AS employment_links_ativos,
       (SELECT count(*) FROM public.link_group_workers lgw
          WHERE lgw.worker_id = c.id AND lgw.deleted_at IS NULL) AS link_group_workers_ativos,
       (SELECT count(*) FROM public.worker_documents wd
          WHERE wd.worker_id = c.id AND wd.deleted_at IS NULL) AS worker_documents_ativos,
       (w.linked_profile_id IS NOT NULL) AS possui_linked_profile
FROM candidatos c
JOIN public.workers w ON w.id = c.id
ORDER BY c.id;

-- ---------------------------------------------------------------------
-- Exportação CSV (opcional). Descomente para gerar o snapshot completo.
-- ---------------------------------------------------------------------
-- \copy (SELECT * FROM public.workers WHERE deleted_at IS NULL) TO '/mnt/documents/sst-dedup-dry-run-workers.csv' WITH CSV HEADER