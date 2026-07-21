import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ComplianceStatus =
  | "missing"
  | "expired"
  | "pending"
  | "warning"
  | "ok";

export type ComplianceOverall = "apto" | "atencao" | "bloqueado" | "nao_configurado";

export interface ComplianceDocument {
  document_type_id: string;
  code: string;
  name: string;
  category: string;
  status: ComplianceStatus;
  status_code: ComplianceStatus;
  status_label: string;
  status_reason: string;
  expires_at: string | null;
  days_remaining: number | null;
  worker_document_id: string | null;
  is_mandatory: boolean;
  required_by: "job_role" | "event" | "client" | "legal" | "manual";
}

export interface ComplianceScore {
  required: number;
  valid: number;
  warning: number;
  expired: number;
  missing: number;
  pending: number;
  percent: number;
}

export interface LinkComplianceResult {
  schema_version: number;
  overall: ComplianceOverall;
  link_id: string;
  worker: { id: string; name: string } | null;
  job_role: { id: string; name: string } | null;
  score: ComplianceScore;
  documents: ComplianceDocument[];
  evaluated_at: string;
  warning_days: number;
  error?: string;
}

/**
 * Fonte única de verdade para conformidade documental de um vínculo.
 * Nenhum componente deve chamar a RPC diretamente ou recalcular status.
 */
export function useLinkCompliance(linkId: string | null | undefined) {
  return useQuery({
    queryKey: ["link-compliance", linkId],
    enabled: !!linkId,
    staleTime: 30_000,
    queryFn: async (): Promise<LinkComplianceResult> => {
      const { data, error } = await supabase.rpc("evaluate_link_compliance", {
        p_link_id: linkId!,
      });
      if (error) throw error;
      return data as unknown as LinkComplianceResult;
    },
  });
}

export const OVERALL_LABEL: Record<ComplianceOverall, string> = {
  apto: "Apto",
  atencao: "Atenção",
  bloqueado: "Bloqueado",
  nao_configurado: "Não configurado",
};

export const STATUS_TONE: Record<ComplianceStatus, "success" | "warning" | "danger" | "muted"> = {
  ok: "success",
  warning: "warning",
  pending: "warning",
  expired: "danger",
  missing: "danger",
};

export const OVERALL_TONE: Record<ComplianceOverall, "success" | "warning" | "danger" | "muted"> = {
  apto: "success",
  atencao: "warning",
  bloqueado: "danger",
  nao_configurado: "muted",
};