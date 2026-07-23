import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type QualStatus =
  | "ok"
  | "warning"
  | "expired"
  | "missing"
  | "not_applicable"
  | "context_unresolved";

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
  is_required?: boolean;
  has_document?: boolean;
  required_by_sources?: string[];
}

export interface QualContext {
  employment_link_id: string | null;
  link_group_worker_id: string | null;
  link_group_id: string | null;
  event_id: string | null;
  event_name: string | null;
  job_role_id: string | null;
  job_role_name: string | null;
  context_source: "formal_link" | "legacy_role_fk" | "legacy_exact_text_match" | "unresolved_role";
  context_status: "active" | "historical" | "unresolved";
}

export interface QualRow {
  worker_id: string;
  worker_name: string;
  cpf: string | null;
  cells: QualCell[];
  counters: {
    expired: number;
    warning: number;
    missing: number;
    ok: number;
    context_unresolved?: number;
    not_applicable?: number;
  };
  contexts?: QualContext[];
  n_active_contexts?: number;
  n_unresolved_contexts?: number;
}

export interface QualTotals {
  total_workers: number;
  total_active_contexts: number;
  total_missing: number;
  total_expired: number;
  total_warning: number;
  total_context_unresolved: number;
  total_not_applicable: number;
}

export interface QualMatrix {
  schema_version: number;
  generated_at: string;
  columns: QualColumn[];
  items: QualRow[];
  total: number;
  warning_days: number;
  totals?: QualTotals;
}

export interface QualFilters {
  search?: string;
  state?: QualStatus | null;
  documentTypeIds?: string[] | null;
  onlyRelevant?: boolean;
  onlyActiveContexts?: boolean;
  eventId?: string | null;
  linkGroupId?: string | null;
  jobRoleId?: string | null;
  limit?: number;
  offset?: number;
}

export function useWorkerQualifications(filters: QualFilters) {
  return useQuery({
    queryKey: ["worker-qualifications", filters],
    // Não consultar quando o usuário desmarcou todas as colunas.
    enabled: filters.documentTypeIds == null || filters.documentTypeIds.length > 0,
    queryFn: async (): Promise<QualMatrix> => {
      const { data, error } = await supabase.rpc("list_worker_qualifications", {
        p_search: filters.search || null,
        p_state: filters.state || null,
        // Passa exatamente a seleção. null = "todos" (comportamento antigo do RPC).
        p_document_type_ids: filters.documentTypeIds ?? null,
        p_only_relevant: filters.onlyActiveContexts ? false : (filters.onlyRelevant ?? false),
        p_only_active_contexts: filters.onlyActiveContexts ?? false,
        p_event_id: filters.eventId ?? null,
        p_link_group_id: filters.linkGroupId ?? null,
        p_job_role_id: filters.jobRoleId ?? null,
        p_limit: filters.limit ?? 200,
        p_offset: filters.offset ?? 0,
      } as any);
      if (error) throw error;
      return data as unknown as QualMatrix;
    },
    staleTime: 60 * 1000,
  });
}