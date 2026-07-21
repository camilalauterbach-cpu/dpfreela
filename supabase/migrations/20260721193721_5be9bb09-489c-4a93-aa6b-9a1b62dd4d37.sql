
CREATE OR REPLACE FUNCTION public.document_type_usage_counts()
RETURNS TABLE(document_type_id uuid, worker_count bigint, link_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH w AS (
    SELECT wd.document_type_id, COUNT(DISTINCT wd.worker_id) AS c
      FROM public.worker_documents wd
     WHERE wd.deleted_at IS NULL AND wd.document_type_id IS NOT NULL
     GROUP BY wd.document_type_id
  ),
  l AS (
    SELECT dt.id AS document_type_id, COUNT(DISTINCT eld.employment_link_id) AS c
      FROM public.employment_link_documents eld
      JOIN public.document_types dt ON dt.code = eld.document_type
     WHERE eld.deleted_at IS NULL
     GROUP BY dt.id
  )
  SELECT dt.id,
         COALESCE(w.c, 0)::bigint,
         COALESCE(l.c, 0)::bigint
    FROM public.document_types dt
    LEFT JOIN w ON w.document_type_id = dt.id
    LEFT JOIN l ON l.document_type_id = dt.id;
$$;

REVOKE ALL ON FUNCTION public.document_type_usage_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_type_usage_counts() TO authenticated;
