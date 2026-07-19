import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ComplianceSummaryTotals {
  workers: number;
  links: number;
  job_roles: number;
  aptos: number;
  atencao: number;
  bloqueados: number;
}

export interface ComplianceSummaryDocuments {
  ok: number;
  warning: number;
  expired: number;
  missing: number;
  pending: number;
}

export interface ComplianceSummaryByRole {
  job_role_id: string;
  job_role_name: string;
  total_links: number;
  aptos: number;
  atencao: number;
  bloqueados: number;
  percent_avg: number;
}

export interface ComplianceSummaryTopPending {
  document_type_id: string;
  code: string;
  name: string;
  pending_count: number;
}

export interface DocumentComplianceSummary {
  schema_version: number;
  generated_at: string;
  warning_days: number;
  totals: ComplianceSummaryTotals;
  documents: ComplianceSummaryDocuments;
  by_role: ComplianceSummaryByRole[];
  top_pending_documents: ComplianceSummaryTopPending[];
}

/**
 * Payload agregado de conformidade documental (Dashboard).
 * Uma única chamada substitui múltiplas consultas.
 */
export function useDocumentComplianceSummary(warningDays = 30) {
  return useQuery({
    queryKey: ["document-compliance-summary", warningDays],
    staleTime: 60_000,
    queryFn: async (): Promise<DocumentComplianceSummary> => {
      const { data, error } = await supabase.rpc("document_compliance_summary", {
        p_warning_days: warningDays,
      });
      if (error) throw error;
      return data as unknown as DocumentComplianceSummary;
    },
  });
}