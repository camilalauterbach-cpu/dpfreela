import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ComplianceEventSource =
  | "upload"
  | "expiration"
  | "admin_update"
  | "job_role_change"
  | "migration"
  | "system"
  | "manual"
  | "reevaluate";

/**
 * Fonte única de invalidação para cache de conformidade documental.
 * Deve ser chamada após qualquer mutação que afete os documentos do
 * trabalhador ou os requisitos por cargo: upload, exclusão, alteração
 * de validade, aprovação/rejeição, alteração de requisitos.
 */
export function invalidateComplianceCaches(
  queryClient: QueryClient,
  opts: {
    workerId?: string;
    linkId?: string;
    jobRoleId?: string;
    eventSource?: ComplianceEventSource;
  } = {},
) {
  // Avaliação por vínculo
  queryClient.invalidateQueries({ queryKey: ["link-compliance"] });
  // Agregado do Dashboard
  queryClient.invalidateQueries({ queryKey: ["document-compliance-summary"] });
  // Listagem geral de conformidade
  queryClient.invalidateQueries({ queryKey: ["link-compliance-list"] });

  if (opts.workerId) {
    queryClient.invalidateQueries({ queryKey: ["worker-documents", opts.workerId] });
  }
  if (opts.linkId) {
    queryClient.invalidateQueries({ queryKey: ["link-compliance", opts.linkId] });
    queryClient.invalidateQueries({ queryKey: ["compliance-timeline", opts.linkId] });
  }

  // Fire-and-forget reavaliação (transições apenas) — single funnel.
  const source = opts.eventSource ?? "system";
  if (opts.linkId) {
    (supabase.rpc as any)("record_compliance_transitions", {
      p_link_id: opts.linkId,
      p_event_source: source,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["compliance-timeline", opts.linkId] });
    });
  } else if (opts.workerId) {
    (supabase.rpc as any)("reevaluate_worker_links", {
      p_worker_id: opts.workerId,
      p_event_source: source,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["compliance-timeline"] });
    });
  } else if (opts.jobRoleId) {
    (supabase.rpc as any)("reevaluate_job_role_links", {
      p_job_role_id: opts.jobRoleId,
      p_event_source: source,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["compliance-timeline"] });
    });
  }
}