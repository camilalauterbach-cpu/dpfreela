import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ComplianceEntityType = "document" | "overall";
export type ComplianceEventSource =
  | "upload"
  | "expiration"
  | "admin_update"
  | "job_role_change"
  | "migration"
  | "system"
  | "manual"
  | "reevaluate";

export interface ComplianceTimelineItem {
  id: string;
  created_at: string;
  entity_type: ComplianceEntityType;
  previous_status: string | null;
  current_status: string;
  reason: string | null;
  event_source: ComplianceEventSource;
  changed_by: string | null;
  changed_by_name: string | null;
  document_type_id: string | null;
  document_code: string | null;
  document_name: string | null;
  document_category: string | null;
}

export interface ComplianceTimelineResult {
  schema_version: number;
  link_id: string;
  generated_at: string;
  items: ComplianceTimelineItem[];
}

export function useComplianceTimeline(
  linkId: string | null | undefined,
  limit = 200,
) {
  return useQuery({
    queryKey: ["compliance-timeline", linkId, limit],
    enabled: !!linkId,
    staleTime: 30_000,
    queryFn: async (): Promise<ComplianceTimelineResult> => {
      const { data, error } = await (supabase.rpc as any)(
        "get_link_compliance_timeline",
        { p_link_id: linkId!, p_limit: limit },
      );
      if (error) throw error;
      return data as ComplianceTimelineResult;
    },
  });
}