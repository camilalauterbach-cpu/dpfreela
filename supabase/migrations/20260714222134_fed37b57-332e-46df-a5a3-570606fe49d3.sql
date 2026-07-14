-- Migração 0: link_group_workers unique parcial
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT 1
    FROM public.link_group_workers
    WHERE deleted_at IS NULL
    GROUP BY link_group_id, worker_id
    HAVING count(*) > 1
  ) s;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Migração 0 abortada: % par(es) ativo(s) duplicado(s) em link_group_workers (link_group_id + worker_id) com deleted_at IS NULL. Nenhuma alteração aplicada.',
      v_dup_count
      USING ERRCODE = '23505';
  END IF;
END $$;

ALTER TABLE public.link_group_workers
  DROP CONSTRAINT IF EXISTS link_group_workers_link_group_id_worker_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS link_group_workers_unique_active_group_worker
  ON public.link_group_workers (link_group_id, worker_id)
  WHERE deleted_at IS NULL;