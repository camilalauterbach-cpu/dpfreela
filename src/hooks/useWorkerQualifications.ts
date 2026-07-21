import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type QualStatus = "ok" | "warning" | "expired" | "missing" | "not_applicable";

export interface QualColumn {
  document_type_id: string;
  code: string;
  name: string;
  category: "sst_nr" | "sst_aso" | "training" | string;
}

export interface QualCell {
  document_type_id: string;
  status: QualStatus;
  expiry_date: string | null;
  issue_date: string | null;
  issuer: string | null;
  file_path: string | null;
  worker_document_id: string | null;
  is_relevant: boolean;
}

export interface QualRow {
  worker_id: string;
  worker_name: string;
  cpf: string | null;
  cells: QualCell[];
  counters: { expired: number; warning: number; missing: number; ok: number };
}

export interface QualMatrix {
  schema_version: number;
  generated_at: string;
  columns: QualColumn[];
  items: QualRow[];
  total: number;
  warning_days: number;
}

export interface QualFilters {
  search?: string;
  state?: QualStatus | null;
  documentTypeIds?: string[] | null;
  onlyRelevant?: boolean;
  limit?: number;
  offset?: number;
}

export function useWorkerQualifications(filters: QualFilters) {
  return useQuery({
    queryKey: ["worker-qualifications", filters],
    queryFn: async (): Promise<QualMatrix> => {
      const { data, error } = await supabase.rpc("list_worker_qualifications", {
        p_search: filters.search || null,
        p_state: filters.state || null,
        p_document_type_ids: filters.documentTypeIds?.length ? filters.documentTypeIds : null,
        p_only_relevant: filters.onlyRelevant ?? true,
        p_limit: filters.limit ?? 200,
        p_offset: filters.offset ?? 0,
      });
      if (error) throw error;
      return data as unknown as QualMatrix;
    },
    staleTime: 60 * 1000,
  });
}