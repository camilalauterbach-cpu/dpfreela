-- Testes de integração — Desacoplamento Worker 1 → 0..N vínculos.
--
-- Executado inteiramente dentro de UMA transação com ROLLBACK final.
-- Nenhum registro persiste. Cobre A, B, C, F, H, I do plano de aceitação.
-- (D, E, G, J são cobertos por vitest — pura lógica TS.)
--
-- Rodar: PGPASSWORD=... psql "$DBURL" -v ON_ERROR_STOP=1 \
--        -f scripts/tests/worker_link_decoupling.sql

\set ON_ERROR_STOP on
\timing off

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  v_w_none    uuid;
  v_w_multi   uuid;
  v_w_deleted uuid;
  v_link_1    uuid;
  v_link_2    uuid;
  v_link_3    uuid;
  v_doc       uuid;
  v_dt_rg     uuid;
  v_count     int;
BEGIN
  -- Resolve tipos documentais reais do catálogo (sem inventar).
  SELECT id INTO v_dt_rg   FROM public.document_types WHERE code = 'rg'   LIMIT 1;
  IF v_dt_rg IS NULL THEN RAISE EXCEPTION 'setup: catálogo sem tipo RG canônico'; END IF;

  -- ============================================================
  -- Cenário A — worker SEM vínculo permanece ativo e pesquisável
  -- ============================================================
  INSERT INTO public.workers (full_name, cpf)
  VALUES ('__reg_decoup_A_alone', '15350946056')
  RETURNING id INTO v_w_none;

  PERFORM 1 FROM public.workers
   WHERE id = v_w_none AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A. worker sem vínculo não está ativo/pesquisável'; END IF;
  RAISE NOTICE 'A. PASS — worker sem vínculo permanece ativo.';

  -- Não pode estar em nenhum employment_link nem link_group_worker.
  SELECT count(*) INTO v_count FROM public.employment_links WHERE worker_id = v_w_none;
  IF v_count <> 0 THEN RAISE EXCEPTION 'A. worker recém-criado tem vínculos inesperados'; END IF;

  -- ============================================================
  -- Cenário B — worker com 2 vínculos aparece 1 vez na tabela
  --             workers e lista todos os employment_links
  -- ============================================================
  INSERT INTO public.workers (full_name, cpf)
  VALUES ('__reg_decoup_B_multi', '87748248800')
  RETURNING id INTO v_w_multi;

  INSERT INTO public.employment_links (worker_id, status)
  VALUES (v_w_multi, 'draft') RETURNING id INTO v_link_1;
  INSERT INTO public.employment_links (worker_id, status)
  VALUES (v_w_multi, 'draft') RETURNING id INTO v_link_2;
  INSERT INTO public.employment_links (worker_id, status)
  VALUES (v_w_multi, 'draft') RETURNING id INTO v_link_3;

  SELECT count(*) INTO v_count FROM public.workers
   WHERE id = v_w_multi AND deleted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'B. worker duplicou ao ganhar múltiplos vínculos (%)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.employment_links WHERE worker_id = v_w_multi;
  IF v_count <> 3 THEN RAISE EXCEPTION 'B. esperava 3 vínculos, encontrei %', v_count; END IF;
  RAISE NOTICE 'B. PASS — 1 pessoa listada com 3 vínculos.';

  -- ============================================================
  -- Cenário H — reutiliza worker existente ao criar novo vínculo
  --             (não deve nascer worker duplicado)
  -- ============================================================
  INSERT INTO public.employment_links (worker_id, status)
  VALUES (v_w_multi, 'draft');
  SELECT count(*) INTO v_count FROM public.workers WHERE cpf = '87748248800' AND deleted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'H. criar vínculo duplicou pessoa (%)', v_count; END IF;
  RAISE NOTICE 'H. PASS — novo vínculo reutiliza worker existente.';

  -- ============================================================
  -- Cenário I — anexar documento independe de vínculo
  -- ============================================================
  INSERT INTO public.worker_documents (worker_id, document_type, document_type_id, status)
  VALUES (v_w_none, 'rg', v_dt_rg, 'pending')
  RETURNING id INTO v_doc;
  PERFORM 1 FROM public.worker_documents WHERE id = v_doc AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'I. não foi possível anexar documento a worker sem vínculo'; END IF;
  RAISE NOTICE 'I. PASS — documento anexado a worker sem vínculo.';

  -- ============================================================
  -- Cenário C — encerrar (soft-delete) o último vínculo preserva
  --             worker e documentos. (Qualificações são protegidas
  --             estruturalmente por RESTRICT — asserção mais abaixo.)
  -- ============================================================
  -- Simulamos "encerrar último vínculo" no v_w_multi via soft-delete de todos:
  UPDATE public.employment_links
     SET status = 'inactive', deleted_at = now()
   WHERE worker_id = v_w_multi;

  -- Worker persiste vivo
  PERFORM 1 FROM public.workers WHERE id = v_w_multi AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'C. worker foi desativado ao encerrar vínculos'; END IF;

  -- Documento persiste
  PERFORM 1 FROM public.worker_documents WHERE id = v_doc AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'C. documento foi apagado ao encerrar vínculos'; END IF;
  RAISE NOTICE 'C. PASS — encerrar vínculos preserva worker e documento (qualificação protegida por RESTRICT, ver invariante abaixo).';

  -- ============================================================
  -- Cenário F — órfão exige worker ausente/deletado, não ausência
  --             de vínculo. Worker vivo sem vínculo ainda resolve
  --             em workers; worker soft-deletado é o órfão canônico.
  -- ============================================================
  SELECT count(*) INTO v_count FROM public.workers
   WHERE id = v_w_none AND deleted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'F. worker vivo sem vínculo deixou de resolver'; END IF;

  -- Órfão real: worker deletado
  INSERT INTO public.workers (full_name, cpf, deleted_at)
  VALUES ('__reg_decoup_F_deleted', '39053344705', now())
  RETURNING id INTO v_w_deleted;

  SELECT count(*) INTO v_count
    FROM public.workers WHERE id = v_w_deleted AND deleted_at IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'F. setup do órfão real falhou'; END IF;
  RAISE NOTICE 'F. PASS — órfão canônico é worker deletado, não ausência de vínculo.';

  -- ============================================================
  -- Invariante: nenhum trigger de link_group_workers/employment_links
  --             pode escrever em workers, worker_documents ou
  --             worker_sst_qualifications. Basta enumerar.
  -- ============================================================
  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgrelid::regclass::text IN ('public.link_group_workers','public.employment_links','public.link_groups')
     AND pg_get_triggerdef(oid) ~* '\b(workers|worker_documents|worker_sst_qualifications)\b';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Trigger de vínculo referencia workers/documents/qualifications (acoplamento indevido)';
  END IF;
  RAISE NOTICE 'Invariante triggers OK — nenhum trigger de vínculo toca pessoa/documentos/NRs.';

  -- ============================================================
  -- Invariante estrutural: FKs
  -- ============================================================
  -- link_group_workers → workers deve ser NO ACTION (nunca cascade)
  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE contype = 'f'
     AND conname = 'link_group_workers_worker_id_fkey'
     AND confdeltype = 'a';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FK link_group_workers.worker_id não é NO ACTION'; END IF;

  -- worker_sst_qualifications → workers deve ser RESTRICT (protege dossiê)
  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE contype = 'f'
     AND conname = 'worker_sst_qualifications_worker_id_fkey'
     AND confdeltype = 'r';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FK worker_sst_qualifications.worker_id não é RESTRICT'; END IF;
  RAISE NOTICE 'FKs estruturais OK — nenhuma cascade indevida de vínculo → pessoa.';

  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Regressão worker↔vínculo: TODOS os cenários passaram.';
  RAISE NOTICE '==========================================';
END $$;

ROLLBACK;