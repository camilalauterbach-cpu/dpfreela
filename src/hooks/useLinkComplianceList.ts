import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ComplianceOverall, ComplianceDocument, ComplianceScore } from "./useLinkCompliance";

export interface ComplianceListFilters {
  compliance?: ComplianceOverall | null;
  doc?: string | null;
  jobRoleId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface ComplianceListItem {
  link_id: string;
  worker_id: string;
  worker_name: string | null;
  job_role_id: string | null;
  job_role_name: string | null;
  overall: ComplianceOverall;
  score: ComplianceScore;
  documents: ComplianceDocument[];
}

export interface ComplianceListResult {
  schema_version: number;
  generated_at: string;
  total: number;
  limit: number;
  offset: number;
  items: ComplianceListItem[];
}

export function useLinkComplianceList(filters: ComplianceListFilters) {
  const {
    compliance = null,
    doc = null,
    jobRoleId = null,
    search = null,
    limit = 100,
    offset = 0,
  } = filters;

  return useQuery({
    queryKey: ["link-compliance-list", { compliance, doc, jobRoleId, search, limit, offset }],
    staleTime: 30_000,
    queryFn: async (): Promise<ComplianceListResult> => {
      const { data, error } = await (supabase.rpc as any)("list_link_compliance", {
        p_compliance: compliance,
        p_doc_code: doc,
        p_job_role_id: jobRoleId,
        p_search: search,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      return data as ComplianceListResult;
    },
  });
}